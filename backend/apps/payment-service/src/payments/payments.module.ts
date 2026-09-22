import { OutboxModule } from '@bnpl/outbox';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionStatusHistory } from './entities/transaction-status-history.entity';
import { Transaction } from './entities/transaction.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { FakePaymentGateway } from './gateways/fake-payment.gateway';
import { InstallmentChargeConsumer } from './installment-charge.consumer';
import { PAYMENT_GATEWAY } from './ports/payment-gateway.port';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhookProcessorConsumer } from './webhook-processor.consumer';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, TransactionStatusHistory, WebhookEvent]),
    OutboxModule.forFeature({ producerName: 'payment-service' }),
  ],
  controllers: [PaymentsController, WebhooksController],
  providers: [
    PaymentsService,
    WebhookProcessorConsumer,
    InstallmentChargeConsumer,
    FakePaymentGateway,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (config: ConfigService, fake: FakePaymentGateway) => {
        const provider = config.get<string>('PAYMENT_GATEWAY_PROVIDER', 'fake');
        switch (provider) {
          case 'fake':
            return fake;
          default:
            throw new Error(
              `Unsupported PAYMENT_GATEWAY_PROVIDER "${provider}" — implement a PaymentGatewayPort adapter for it.`,
            );
        }
      },
      inject: [ConfigService, FakePaymentGateway],
    },
  ],
})
export class PaymentsModule {}
