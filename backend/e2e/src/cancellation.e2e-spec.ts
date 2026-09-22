import { api, registerAndLogin, waitUntil } from './client';

// System suite: same assumptions as happy-path.e2e-spec.ts — full stack up
// via api-gateway. Covers order-service's reaction to a payment that never
// actually completed: voiding an AUTHORIZED payment should cancel the order
// instead of leaving it stuck at CREATED forever.
describe('Order auto-cancellation on a voided payment', () => {
  it(
    'checkout -> pay -> void (before capture) -> order is CANCELLED',
    async () => {
      const { token, userId } = await registerAndLogin('e2e-cancel');

      const products = await api.listProducts(1);
      const product = products.body.items[0];
      expect(product).toBeDefined();

      const addRes = await api.addToCart(token, {
        userId,
        productId: product.id,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity: 1,
      });
      expect(addRes.status).toBe(201);

      const checkout = await api.checkout(token, userId);
      expect(checkout.status).toBe(201);
      expect(checkout.body.status).toBe('CREATED');
      const orderId = checkout.body.id;

      const payment = await api.pay(token, {
        orderId,
        userId,
        amountCents: product.priceCents,
        currency: 'USD',
        paymentMethod: 'FULL',
      });
      expect(payment.status).toBe(201);
      expect(payment.body.status).toBe('AUTHORIZED');
      const transactionId = payment.body.id;

      // Void before the fake gateway's ~2s async capture webhook arrives, so
      // the transaction is still AUTHORIZED (the only status voidPayment accepts).
      const voidRes = await api.voidPayment(token, transactionId);
      expect(voidRes.status).toBe(201);
      expect(voidRes.body.status).toBe('VOIDED');

      await waitUntil(async () => {
        const res = await api.getOrder(token, orderId);
        return res.body.status === 'CANCELLED';
      });
    },
    30000,
  );
});
