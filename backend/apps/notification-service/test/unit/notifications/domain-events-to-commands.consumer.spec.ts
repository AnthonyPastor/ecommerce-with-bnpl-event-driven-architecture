import { buildEventEnvelope, KafkaTopics } from '@bnpl/event-contracts';
import { buildEmailCommand } from '../../../src/notifications/domain-events-to-commands.consumer';

function envelope(eventType: string, payload: Record<string, unknown>) {
  return buildEventEnvelope({
    eventType,
    aggregateType: 'Test',
    aggregateId: 'agg-1',
    producer: 'test',
    correlationId: 'corr-1',
    payload,
  });
}

describe('buildEmailCommand', () => {
  it('maps order.order.created.v1 to an order_confirmation email', () => {
    const command = buildEmailCommand(envelope(KafkaTopics.order.created, { userId: 'user-1', orderId: 'order-1' }));
    expect(command).toEqual({
      to: 'user-1',
      template: 'order_confirmation',
      data: { userId: 'user-1', orderId: 'order-1' },
    });
  });

  it('maps bnpl.installment.due.v1 to an installment_due email', () => {
    const command = buildEmailCommand(envelope(KafkaTopics.bnpl.installmentDue, { userId: 'user-2' }));
    expect(command?.template).toBe('installment_due');
  });

  it('maps payment.transaction.refunded.v1 to a payment_refunded email', () => {
    const command = buildEmailCommand(envelope(KafkaTopics.payment.refunded, { userId: 'user-3' }));
    expect(command?.template).toBe('payment_refunded');
  });

  it('returns null for event types we do not send email for', () => {
    const command = buildEmailCommand(envelope(KafkaTopics.cart.checkedOut, { userId: 'user-4' }));
    expect(command).toBeNull();
  });

  it('falls back to "unknown-user" when the payload has no userId', () => {
    const command = buildEmailCommand(envelope(KafkaTopics.order.created, {}));
    expect(command?.to).toBe('unknown-user');
  });
});
