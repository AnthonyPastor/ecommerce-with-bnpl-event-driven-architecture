import { EventEnvelope, KafkaTopics, RabbitMqTopology } from '@bnpl/event-contracts';
import { KafkaConsumerService } from '@bnpl/kafka-client';
import { RabbitMqPublisherService } from '@bnpl/rabbitmq-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SendEmailCommand } from './send-email.command';

/**
 * Kafka -> RabbitMQ translator: listens to domain events (Kafka, immutable,
 * audit trail) and for each one we care about publishes an `email.send`
 * command on RabbitMQ (with retries/DLQ — see EmailCommandConsumer). This
 * consumer is deliberately "dumb": it only translates, it doesn't retry or
 * know anything about delivery details.
 */
@Injectable()
export class DomainEventsToCommandsConsumer implements OnModuleInit {
  private readonly logger = new Logger(DomainEventsToCommandsConsumer.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly rabbitPublisher: RabbitMqPublisherService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaConsumer.subscribe(
      [
        KafkaTopics.order.created,
        KafkaTopics.bnpl.installmentDue,
        KafkaTopics.payment.refunded,
        KafkaTopics.payment.authorizationFailed,
        KafkaTopics.payment.captureFailed,
      ],
      (envelope) => this.translate(envelope),
      'notification-service',
    );
  }

  private async translate(envelope: EventEnvelope): Promise<void> {
    const command = buildEmailCommand(envelope);
    if (!command) {
      this.logger.warn(`No email template mapped for event type ${envelope.eventType}, ignoring`);
      return;
    }
    this.rabbitPublisher.publish(RabbitMqTopology.exchange, RabbitMqTopology.routingKeys.emailSend, command);
  }
}

/**
 * Pure function (easy to test without mocking Kafka/RabbitMQ): maps a
 * domain event to the corresponding email command, or null if we don't
 * care about it. Exported separately from the class on purpose.
 */
export function buildEmailCommand(envelope: EventEnvelope): SendEmailCommand | null {
  const payload = envelope.payload as Record<string, unknown>;
  // TODO: resolve userId -> real email (by calling auth-service, or via a
  // local read-model fed by auth.user.registered.v1) — for now we use the
  // userId as the "recipient" since ConsoleEmailProvider only logs, it
  // doesn't actually deliver mail.
  const to = String(payload.userId ?? 'unknown-user');

  switch (envelope.eventType) {
    case KafkaTopics.order.created:
      return { to, template: 'order_confirmation', data: payload };
    case KafkaTopics.bnpl.installmentDue:
      return { to, template: 'installment_due', data: payload };
    case KafkaTopics.payment.refunded:
      return { to, template: 'payment_refunded', data: payload };
    case KafkaTopics.payment.authorizationFailed:
      return { to, template: 'payment_authorization_failed', data: payload };
    case KafkaTopics.payment.captureFailed:
      return { to, template: 'payment_capture_failed', data: payload };
    default:
      return null;
  }
}
