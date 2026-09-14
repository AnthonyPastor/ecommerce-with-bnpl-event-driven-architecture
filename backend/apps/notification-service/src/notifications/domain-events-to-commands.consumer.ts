import { EventEnvelope, KafkaTopics, RabbitMqTopology } from '@bnpl/event-contracts';
import { KafkaConsumerService } from '@bnpl/kafka-client';
import { RabbitMqPublisherService } from '@bnpl/rabbitmq-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SendEmailCommand } from './send-email.command';

/**
 * Traductor Kafka -> RabbitMQ: escucha eventos de dominio (Kafka, inmutables,
 * audit trail) y por cada uno que nos importa publica un comando `email.send`
 * en RabbitMQ (con reintentos/DLQ — ver EmailCommandConsumer). Este consumer
 * queda "tonto" a propósito: solo traduce, no reintenta ni conoce el detalle
 * de envío.
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
      [KafkaTopics.order.created, KafkaTopics.bnpl.installmentDue, KafkaTopics.payment.refunded],
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
 * Función pura (fácil de testear sin mockear Kafka/RabbitMQ): mapea un
 * evento de dominio al comando de email correspondiente, o null si no nos
 * interesa. Exportada aparte de la clase a propósito.
 */
export function buildEmailCommand(envelope: EventEnvelope): SendEmailCommand | null {
  const payload = envelope.payload as Record<string, unknown>;
  // TODO: resolver userId -> email real (llamando a auth-service, o vía un
  // read-model local alimentado por auth.user.registered.v1) — por ahora
  // usamos el userId como "destinatario" ya que el ConsoleEmailProvider
  // solo loguea, no entrega mails de verdad.
  const to = String(payload.userId ?? 'unknown-user');

  switch (envelope.eventType) {
    case KafkaTopics.order.created:
      return { to, template: 'order_confirmation', data: payload };
    case KafkaTopics.bnpl.installmentDue:
      return { to, template: 'installment_due', data: payload };
    case KafkaTopics.payment.refunded:
      return { to, template: 'payment_refunded', data: payload };
    default:
      return null;
  }
}
