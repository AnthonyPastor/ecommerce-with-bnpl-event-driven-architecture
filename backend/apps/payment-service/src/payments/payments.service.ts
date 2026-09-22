import { randomUUID } from 'node:crypto';
import { KafkaTopics, PaymentMethod } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { TransactionStatusHistory } from './entities/transaction-status-history.entity';
import { Transaction } from './entities/transaction.entity';
import { AuthorizeResult, NormalizedWebhookEvent, PAYMENT_GATEWAY, PaymentGatewayPort } from './ports/payment-gateway.port';
import { PaymentStatus, assertTransition, isTerminalPaymentStatus } from './payment-state-machine';
import { withTimeout } from './with-timeout';

interface TransactionPatch {
  gatewayReference?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly gatewayTimeoutMs: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    private readonly requestContext: RequestContextService,
    config: ConfigService,
  ) {
    this.gatewayTimeoutMs = Number(config.get('PAYMENT_GATEWAY_TIMEOUT_MS', 10000));
  }

  /**
   * Creates the Transaction (PENDING) and triggers a sync `authorize` against the gateway.
   * Guards against paying the same order twice: any existing transaction for
   * `orderId` that isn't terminal (per PAYMENT_TRANSITIONS) blocks a new attempt —
   * a failed, voided, refunded, or charged-back one must remain retryable, a
   * captured/in-flight one must not.
   *
   * The guard-check and the PENDING insert run inside one DB transaction, guarded
   * by a Postgres advisory lock keyed on `orderId`. A plain row lock can't help
   * here because on the very first payment for an order there's no row yet to
   * lock — the advisory lock serializes concurrent callers on the key itself, so
   * a second concurrent request can't pass the "no blocking transaction" check
   * before the first one's row is committed.
   */
  async createPayment(dto: CreatePaymentDto): Promise<Transaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let pending: Transaction;
    try {
      await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dto.orderId]);

      const existingForOrder = await queryRunner.manager.find(Transaction, { where: { orderId: dto.orderId } });
      const blocking = existingForOrder.find((t) => !isTerminalPaymentStatus(t.status));
      if (blocking) {
        throw new ConflictException(`Order ${dto.orderId} already has a payment in status ${blocking.status}`);
      }

      pending = queryRunner.manager.create(Transaction, {
        id: randomUUID(),
        orderId: dto.orderId,
        userId: dto.userId,
        installmentId: null,
        amountCents: dto.amountCents,
        currency: dto.currency ?? 'USD',
        status: PaymentStatus.PENDING,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.INSTALLMENTS,
        gatewayProvider: 'fake',
        gatewayReference: null,
        refundedAmountCents: 0,
      });
      await queryRunner.manager.save(pending);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    const { id, currency } = pending;
    // Kept separate from the timed race below: `withTimeout` rejecting on a
    // timeout doesn't cancel the underlying gateway call, so this promise can
    // still resolve AUTHORIZED after we've already committed
    // AUTHORIZATION_FAILED (terminal — nothing else transitions out of it).
    const authorizePromise = this.gateway.authorize({ transactionId: id, amountCents: dto.amountCents, currency });

    try {
      const result = await withTimeout(
        authorizePromise,
        this.gatewayTimeoutMs,
        `Gateway authorize timed out after ${this.gatewayTimeoutMs}ms`,
      );

      return await this.applyTransition(
        id,
        PaymentStatus.AUTHORIZED,
        'sync',
        KafkaTopics.payment.authorized,
        { transactionId: id, orderId: dto.orderId, userId: dto.userId, amountCents: dto.amountCents, currency },
        { gatewayReference: result.gatewayReference },
      );
    } catch (err) {
      await this.applyTransition(
        id,
        PaymentStatus.AUTHORIZATION_FAILED,
        'sync',
        KafkaTopics.payment.authorizationFailed,
        { transactionId: id, orderId: dto.orderId, userId: dto.userId, reason: (err as Error).message },
      );
      this.reconcileLateAuthorization(id, authorizePromise);
      throw err;
    }
  }

  /**
   * Best-effort reconciliation for a gateway authorize call that resolves
   * AFTER we've already committed AUTHORIZATION_FAILED (e.g. it only timed
   * out on our side, per the comment in `createPayment()`). We can't
   * transition out of that terminal status, so instead of leaving the
   * gateway's funds hold dangling with no corresponding payment, void it —
   * and log loudly, since this indicates a real discrepancy worth
   * investigating, not a routine path.
   */
  private reconcileLateAuthorization(transactionId: string, authorizePromise: Promise<AuthorizeResult>): void {
    authorizePromise.then(
      (result) => {
        this.logger.warn(
          `Gateway authorize for transaction ${transactionId} succeeded after it had already been marked AUTHORIZATION_FAILED; voiding the late hold (gatewayReference=${result.gatewayReference})`,
        );
        return this.gateway.void({ transactionId, gatewayReference: result.gatewayReference }).catch((voidErr) => {
          this.logger.error(
            `Failed to void late authorization for transaction ${transactionId}: ${(voidErr as Error).message}`,
          );
        });
      },
      () => {
        // Genuinely failed/rejected too (not just a timeout) — nothing to reconcile.
      },
    );
  }

  /**
   * Charges one bnpl-service installment, triggered by the
   * `payment.charge_installment` RabbitMQ command (see
   * `InstallmentChargeConsumer`) — bnpl-service's poller is the caller, not
   * an HTTP client. Mirrors `createPayment()`'s sync-authorize/async-capture
   * shape exactly (same gateway, same state machine), but:
   * - idempotency is keyed on `installmentId`, not `orderId` — the order's
   *   *original* Transaction is still `CAPTURED` (non-terminal in the sense
   *   `createPayment()`'s guard cares about) for the plan's whole lifetime,
   *   so an installment charge needs its own lock/guard, not `createPayment()`'s.
   * - a redelivered/duplicate charge command for an installment that already
   *   has a non-terminal charge Transaction in flight is a safe no-op
   *   (returns null) rather than a thrown `ConflictException` — this is a
   *   command queue, not a client-facing endpoint, so a "duplicate" isn't a
   *   caller error to reject, just redelivery to ignore.
   */
  async chargeInstallment(input: {
    installmentId: string;
    orderId: string;
    userId: string;
    amountCents: number;
    currency: string;
  }): Promise<Transaction | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let pending: Transaction;
    try {
      await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.installmentId]);

      const existingForInstallment = await queryRunner.manager.find(Transaction, {
        where: { installmentId: input.installmentId },
      });
      const blocking = existingForInstallment.find((t) => !isTerminalPaymentStatus(t.status));
      if (blocking) {
        this.logger.log(
          `Installment ${input.installmentId} already has an in-flight charge (transaction ${blocking.id}), ignoring redelivery`,
        );
        await queryRunner.rollbackTransaction();
        return null;
      }

      pending = queryRunner.manager.create(Transaction, {
        id: randomUUID(),
        orderId: input.orderId,
        userId: input.userId,
        installmentId: input.installmentId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: PaymentStatus.PENDING,
        paymentMethod: PaymentMethod.INSTALLMENTS,
        gatewayProvider: 'fake',
        gatewayReference: null,
        refundedAmountCents: 0,
      });
      await queryRunner.manager.save(pending);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    const { id, currency } = pending;
    const authorizePromise = this.gateway.authorize({ transactionId: id, amountCents: input.amountCents, currency });

    try {
      const result = await withTimeout(
        authorizePromise,
        this.gatewayTimeoutMs,
        `Gateway authorize timed out after ${this.gatewayTimeoutMs}ms`,
      );

      return await this.applyTransition(
        id,
        PaymentStatus.AUTHORIZED,
        'sync',
        KafkaTopics.payment.authorized,
        { transactionId: id, installmentId: input.installmentId, orderId: input.orderId, userId: input.userId, amountCents: input.amountCents, currency },
        { gatewayReference: result.gatewayReference },
      );
    } catch (err) {
      // Unlike createPayment()'s AUTHORIZATION_FAILED, this publishes the
      // installment-specific "charge failed" topic (not the generic
      // payment.transaction.authorization_failed.v1) — bnpl-service's retry/
      // DEFAULTED bookkeeping needs to hear about this regardless of which
      // stage of the charge failed, and this also keeps the noise out of
      // order-service's original-payment-failure reaction (harmless either
      // way there, since it's a no-op past CREATED, but this is clearer).
      await this.applyTransition(
        id,
        PaymentStatus.AUTHORIZATION_FAILED,
        'sync',
        KafkaTopics.payment.installmentChargeFailed,
        {
          transactionId: id,
          installmentId: input.installmentId,
          orderId: input.orderId,
          userId: input.userId,
          reason: (err as Error).message,
        },
      );
      this.reconcileLateAuthorization(id, authorizePromise);
      throw err;
    }
  }

  /**
   * Dev endpoint to simulate a refund (full, or partial if `amountCents`
   * is less than the outstanding refundable balance). Triggers `gateway.refund()`,
   * which in FakePaymentGateway confirms via an async webhook — same as
   * capture — exercising the same path as a real refund.
   */
  async refundPayment(transactionId: string, amountCents?: number): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (transaction.status !== PaymentStatus.CAPTURED && transaction.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException(`Cannot refund a transaction in status ${transaction.status}`);
    }
    if (!transaction.gatewayReference) {
      throw new BadRequestException('Transaction has no gatewayReference yet');
    }

    const remaining = transaction.amountCents - transaction.refundedAmountCents;
    const requested = amountCents ?? remaining;
    if (requested <= 0 || requested > remaining) {
      throw new BadRequestException(`amountCents must be between 1 and ${remaining} (remaining refundable)`);
    }

    await this.gateway.refund({
      transactionId,
      gatewayReference: transaction.gatewayReference,
      amountCents: requested,
    });

    return transaction;
  }

  /** Dev endpoint to cancel (void) an authorized but not-yet-captured transaction. */
  async voidPayment(transactionId: string): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (transaction.status !== PaymentStatus.AUTHORIZED) {
      throw new BadRequestException(`Cannot void a transaction in status ${transaction.status}`);
    }
    if (!transaction.gatewayReference) {
      throw new BadRequestException('Transaction has no gatewayReference yet');
    }

    await this.gateway.void({ transactionId, gatewayReference: transaction.gatewayReference });

    return this.applyTransition(transactionId, PaymentStatus.VOIDED, 'sync', KafkaTopics.payment.voided, {
      transactionId,
      orderId: transaction.orderId,
      userId: transaction.userId,
    });
  }

  /**
   * Dev endpoint that simulates the card network notifying a chargeback —
   * unlike refund/void, this is NOT triggered by the merchant (there's no
   * "asking the gateway" for a chargeback), so here we drive the two
   * transitions directly (CAPTURED -> DISPUTED -> CHARGEBACK) without going
   * through the gateway or a real webhook.
   */
  async simulateChargeback(transactionId: string): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (transaction.status !== PaymentStatus.CAPTURED && transaction.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException(`Cannot open a dispute on a transaction in status ${transaction.status}`);
    }

    await this.applyTransition(transactionId, PaymentStatus.DISPUTED, 'webhook', KafkaTopics.payment.disputeOpened, {
      transactionId,
      orderId: transaction.orderId,
      userId: transaction.userId,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
    });

    return this.applyTransition(
      transactionId,
      PaymentStatus.CHARGEBACK,
      'webhook',
      KafkaTopics.payment.chargebackReceived,
      {
        transactionId,
        orderId: transaction.orderId,
        userId: transaction.userId,
        amountCents: transaction.amountCents,
        currency: transaction.currency,
      },
    );
  }

  /**
   * Dev endpoint that simulates the card network resolving an open dispute
   * in the merchant's favor — like `simulateChargeback()`, this is NOT
   * triggered by the merchant, so it drives the transition directly
   * (DISPUTED -> CAPTURED) without going through the gateway or a real
   * webhook.
   */
  async resolveDispute(transactionId: string): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (transaction.status !== PaymentStatus.DISPUTED) {
      throw new BadRequestException(`Cannot resolve a dispute on a transaction in status ${transaction.status}`);
    }

    return this.applyTransition(
      transactionId,
      PaymentStatus.CAPTURED,
      'webhook',
      KafkaTopics.payment.disputeResolved,
      {
        transactionId,
        orderId: transaction.orderId,
        userId: transaction.userId,
        amountCents: transaction.amountCents,
        currency: transaction.currency,
      },
    );
  }

  /** Applies the state transition corresponding to an already-normalized incoming webhook. */
  async processWebhookEvent(transactionId: string, event: NormalizedWebhookEvent): Promise<void> {
    const transaction = await this.transactions.findOneOrFail({ where: { id: transactionId } });

    switch (event.eventType) {
      case 'capture_succeeded': {
        // An installment charge's Transaction carries installmentId — route
        // its capture to the installment-specific topic instead of the
        // generic one, so bnpl-service's PaymentEventsConsumer doesn't
        // mistake it for the order's original capture (which would try to
        // re-confirm the order / re-activate the plan).
        const eventType = transaction.installmentId
          ? KafkaTopics.payment.installmentChargeCaptured
          : KafkaTopics.payment.captured;
        await this.applyTransition(transaction.id, PaymentStatus.CAPTURED, 'webhook', eventType, {
          transactionId: transaction.id,
          installmentId: transaction.installmentId,
          orderId: transaction.orderId,
          userId: transaction.userId,
          amountCents: event.amountCents ?? transaction.amountCents,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod,
        });
        return;
      }

      case 'capture_failed': {
        const eventType = transaction.installmentId
          ? KafkaTopics.payment.installmentChargeFailed
          : KafkaTopics.payment.captureFailed;
        await this.applyTransition(transaction.id, PaymentStatus.CAPTURE_FAILED, 'webhook', eventType, {
          transactionId: transaction.id,
          installmentId: transaction.installmentId,
          orderId: transaction.orderId,
          userId: transaction.userId,
        });
        return;
      }

      case 'refund_succeeded':
        await this.applyRefund(transaction.id, event.amountCents, 'webhook');
        return;

      default:
        this.logger.warn(`No transition mapped for webhook event type "${event.eventType}", ignoring`);
    }
  }

  async findById(id: string): Promise<Transaction> {
    const transaction = await this.transactions.findOne({ where: { id } });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }
    return transaction;
  }

  async findByGatewayReference(gatewayReference: string): Promise<Transaction | null> {
    return this.transactions.findOne({ where: { gatewayReference } });
  }

  /** Scoped to `userId` so a caller can only ever see their own transactions for the order — see `PaymentsController.findByOrderId`. */
  async findByOrderId(orderId: string, userId: string): Promise<Transaction[]> {
    return this.transactions.find({ where: { orderId, userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Validates the transition with the state machine, persists Transaction +
   * TransactionStatusHistory + the outbox event in the SAME SQL transaction.
   * `source` distinguishes whether the checkout triggered it (sync) or an
   * async gateway webhook did — the business transactionId (= order.id) is
   * always recovered from the Transaction itself, never from the current
   * HTTP context, because an incoming webhook is a brand-new request without
   * that context.
   */
  private async applyTransition(
    transactionId: string,
    to: PaymentStatus,
    source: 'sync' | 'webhook',
    eventType: string,
    payload: Record<string, unknown>,
    patch?: TransactionPatch,
  ): Promise<Transaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transaction = await queryRunner.manager.findOneOrFail(Transaction, {
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      assertTransition(transaction.status, to);
      const fromStatus = transaction.status;
      transaction.status = to;
      if (patch?.gatewayReference) {
        transaction.gatewayReference = patch.gatewayReference;
      }

      this.requestContext.setTransactionId(transaction.orderId);
      const correlationId = this.requestContext.getCorrelationId() ?? 'unknown';

      const saved = await saveWithOutbox(queryRunner, transaction, {
        eventType,
        aggregateType: 'Transaction',
        aggregateId: transaction.id,
        correlationId,
        transactionId: transaction.orderId,
        payload,
      });

      const history = queryRunner.manager.create(TransactionStatusHistory, {
        transaction: saved,
        fromStatus,
        toStatus: to,
        source,
      });
      await queryRunner.manager.save(history);

      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Applies a (possibly partial) refund. Unlike `applyTransition()`, the
   * target status here depends on state that can itself be racing (the
   * transaction's already-refunded total) — so the read, the decision
   * (REFUNDED vs PARTIALLY_REFUNDED) and the write all happen inside the
   * SAME locked transaction, instead of deciding from an earlier unlocked
   * read like `processWebhookEvent()` used to. That's what actually closes
   * the lost-update race for two concurrent/duplicate refund webhooks —
   * locking `applyTransition()`'s read alone wouldn't have been enough,
   * since the value being written would still have been computed upstream
   * from stale data.
   */
  private async applyRefund(
    transactionId: string,
    explicitAmountCents: number | undefined,
    source: 'sync' | 'webhook',
  ): Promise<Transaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transaction = await queryRunner.manager.findOneOrFail(Transaction, {
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });

      const refundedNow = explicitAmountCents ?? transaction.amountCents - transaction.refundedAmountCents;
      const newRefundedTotal = transaction.refundedAmountCents + refundedNow;
      const isFullRefund = newRefundedTotal >= transaction.amountCents;
      const to = isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
      const eventType = isFullRefund ? KafkaTopics.payment.refunded : KafkaTopics.payment.partiallyRefunded;

      assertTransition(transaction.status, to);
      const fromStatus = transaction.status;
      transaction.status = to;
      transaction.refundedAmountCents = newRefundedTotal;

      this.requestContext.setTransactionId(transaction.orderId);
      const correlationId = this.requestContext.getCorrelationId() ?? 'unknown';

      const saved = await saveWithOutbox(queryRunner, transaction, {
        eventType,
        aggregateType: 'Transaction',
        aggregateId: transaction.id,
        correlationId,
        transactionId: transaction.orderId,
        payload: {
          transactionId: transaction.id,
          orderId: transaction.orderId,
          userId: transaction.userId,
          amountCents: refundedNow,
          currency: transaction.currency,
        },
      });

      const history = queryRunner.manager.create(TransactionStatusHistory, {
        transaction: saved,
        fromStatus,
        toStatus: to,
        source,
      });
      await queryRunner.manager.save(history);

      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
