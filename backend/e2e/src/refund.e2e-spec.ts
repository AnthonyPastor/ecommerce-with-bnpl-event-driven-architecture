import { api, registerAndLogin, waitUntil } from './client';

// Camino no feliz: refund total después de capturado. Cubre la cascada
// completa payment-service -> (Kafka) -> order-service + bnpl-service.
describe('BNPL refund flow (sistema completo)', () => {
  it(
    'un refund total mueve el pago a REFUNDED, la orden a REFUNDED, y cancela el plan de cuotas',
    async () => {
      const { token, userId } = await registerAndLogin('e2e-refund');

      const products = await api.listProducts(1);
      const product = products.body.items[0];

      await api.addToCart(token, {
        userId,
        productId: product.id,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity: 1,
      });
      const checkout = await api.checkout(token, userId);
      const orderId = checkout.body.id;

      const payment = await api.pay(token, {
        orderId,
        userId,
        amountCents: product.priceCents,
        currency: 'USD',
      });
      const transactionId = payment.body.id;

      await waitUntil(async () => {
        const res = await api.getPayment(token, transactionId);
        return res.body.status === 'CAPTURED';
      });

      const refundRes = await api.refundPayment(token, transactionId);
      expect(refundRes.status).toBe(201);

      await waitUntil(async () => {
        const res = await api.getPayment(token, transactionId);
        return res.body.status === 'REFUNDED';
      });

      await waitUntil(async () => {
        const res = await api.getOrder(token, orderId);
        return res.body.status === 'REFUNDED';
      });

      await waitUntil(async () => {
        const res = await api.getInstallmentPlans(token, orderId);
        return res.body.length > 0 && res.body[0].status === 'CANCELLED';
      });
      const plans = await api.getInstallmentPlans(token, orderId);
      expect(plans.body[0].installments.every((i) => i.status === 'CANCELLED')).toBe(true);

      await waitUntil(async () => {
        const res = await api.getNotifications(token, userId);
        return res.body.some((n) => n.template === 'payment_refunded');
      });
    },
    30000,
  );
});
