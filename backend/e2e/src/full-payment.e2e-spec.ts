import { api, registerAndLogin, waitUntil } from './client';

// System suite: same assumptions as happy-path.e2e-spec.ts — full stack up via
// api-gateway. Covers the `paymentMethod: 'FULL'` path: no installment plan
// should ever be created for an order paid in full.
describe('BNPL full payment (no installment plan)', () => {
  it(
    'register -> catalog -> cart -> checkout -> pay in full -> capture -> no installment plan',
    async () => {
      const { token, userId } = await registerAndLogin('e2e-full');

      const products = await api.listProducts(1);
      expect(products.status).toBe(200);
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

      // FakePaymentGateway's async webhook confirms the capture ~2s later.
      await waitUntil(async () => {
        const res = await api.getPayment(token, transactionId);
        return res.body.status === 'CAPTURED';
      });

      // bnpl-service must NOT create a plan for a FULL payment. There's no
      // event to wait on for "nothing happened", so give the captured-event
      // consumer a moment to have run, then assert no plan ever showed up.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const plans = await api.getInstallmentPlans(token, orderId);
      expect(plans.body).toHaveLength(0);
    },
    30000,
  );
});
