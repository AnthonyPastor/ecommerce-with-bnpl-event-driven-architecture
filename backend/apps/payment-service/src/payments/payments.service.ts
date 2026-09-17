import { randomUUID } from 'node:crypto';
import { KafkaTopics, PaymentMethod } from '@bnpl/event-contracts';
import { RequestContextService } from '@bnpl/observability';
import { saveWithOutbox } from '@bnpl/outbox';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { TransactionStatusHistory } from './entities/transaction-status-history.entity';
import { Transaction } from './entities/transaction.entity';
import { NormalizedWebhookEvent, PAYMENT_GATEWAY, PaymentGatewayPort } from './ports/payment-gateway.port';
import { PaymentStatus, assertTransition } from './payment-state-machine';

interface TransactionPatch {
  gatewayReference?: string;
  refundedAmountCents?: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Creates the Transaction (PENDING) and triggers a sync `authorize` against the gateway.
   * Guards against paying the same order twice: any existing transaction for
   * `orderId` other than a failed authorize/capture blocks a new attempt —
   * a failed one must remain retryable, a captured/in-flight one must not.
   */
  async createPayment(dto: CreatePaymentDto): Promise<Transaction> {
    const existingForOrder = await this.transactions.find({ where: { orderId: dto.orderId } });
    const blocking = existingForOrder.find(
      (t) => t.status !== PaymentStatus.AUTHORIZATION_FAILED && t.status !== PaymentStatus.CAPTURE_FAILED,
    );
    if (blocking) {
      throw new ConflictException(`Order ${dto.orderId} already has a payment in status ${blocking.status}`);
    }

    const id = randomUUID();
    const currency = dto.currency ?? 'USD';

    const pending = this.transactions.create({
      id,
      orderId: dto.orderId,
      userId: dto.userId,
      amountCents: dto.amountCents,
      currency,
      status: PaymentStatus.PENDING,
      paymentMethod: dto.paymentMethod ?? PaymentMethod.INSTALLMENTS,
      gatewayProvider: 'fake',
      gatewayReference: null,
      refundedAmountCents: 0,
    });
    await this.transactions.save(pending);

    try {
      const result = await this.gateway.authorize({
        transactionId: id,
        amountCents: dto.amountCents,
        currency,
      });

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

  /** Applies the state transition corresponding to an already-normalized incoming webhook. */
  async processWebhookEvent(transactionId: string, event: NormalizedWebhookEvent): Promise<void> {
    const transaction = await this.transactions.findOneOrFail({ where: { id: transactionId } });

    switch (event.eventType) {
      case 'capture_succeeded':
        await this.applyTransition(transaction.id, PaymentStatus.CAPTURED, 'webhook', KafkaTopics.payment.captured, {
          transactionId: transaction.id,
          orderId: transaction.orderId,
          userId: transaction.userId,
          amountCents: event.amountCents ?? transaction.amountCents,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod,
        });
        return;

      case 'capture_failed':
        await this.applyTransition(
          transaction.id,
          PaymentStatus.CAPTURE_FAILED,
          'webhook',
          KafkaTopics.payment.captureFailed,
          { transactionId: transaction.id, orderId: transaction.orderId, userId: transaction.userId },
        );
        return;

      case 'refund_succeeded': {
        const refundedNow = event.amountCents ?? transaction.amountCents - transaction.refundedAmountCents;
        const newRefundedTotal = transaction.refundedAmountCents + refundedNow;
        const isFullRefund = newRefundedTotal >= transaction.amountCents;
        const to = isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
        const topic = isFullRefund ? KafkaTopics.payment.refunded : KafkaTopics.payment.partiallyRefunded;

        await this.applyTransition(
          transaction.id,
          to,
          'webhook',
          topic,
          {
            transactionId: transaction.id,
            orderId: transaction.orderId,
            userId: transaction.userId,
            amountCents: refundedNow,
            currency: transaction.currency,
          },
          { refundedAmountCents: newRefundedTotal },
        );
        return;
      }

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

  async findByOrderId(orderId: string): Promise<Transaction[]> {
    return this.transactions.find({ where: { orderId }, order: { createdAt: 'DESC' } });
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
      });
      assertTransition(transaction.status, to);
      const fromStatus = transaction.status;
      transaction.status = to;
      if (patch?.gatewayReference) {
        transaction.gatewayReference = patch.gatewayReference;
      }
      if (patch?.refundedAmountCents !== undefined) {
        transaction.refundedAmountCents = patch.refundedAmountCents;
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
}
