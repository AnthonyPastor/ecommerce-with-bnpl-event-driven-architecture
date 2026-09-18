import { api, registerAndLogin, waitUntil } from './client';

// System suite: assumes `docker compose -f backend/infra/docker-compose.yml
// up -d` and all 8 services (`pnpm --filter <service> start:dev` or each
// one's build + `node dist/main.js`) are already running, with api-gateway at
// GATEWAY_URL (default http://localhost:3000/api). It doesn't start anything
// itself — this is the suite that exercises the COMPLETE system end-to-end,
// unlike the per-service e2e suites, which each run in isolation.
describe('BNPL happy path (full system)', () => {
  it(
    'register -> catalog -> cart -> checkout -> payment -> capture -> installment plan -> notification',
    async () => {
      const { token, userId } = await registerAndLogin('e2e-happy');

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
      });
      expect(payment.status).toBe(201);
      expect(payment.body.status).toBe('AUTHORIZED');
      const transactionId = payment.body.id;

      // FakePaymentGateway's async webhook confirms the capture ~2s later.
      await waitUntil(async () => {
        const res = await api.getPayment(token, transactionId);
        return res.body.status === 'CAPTURED';
      });

      // bnpl-service reacts to the captured event (via Kafka) by creating the plan.
      await waitUntil(async () => {
        const res = await api.getInstallmentPlans(token, orderId);
        return res.body.length > 0 && res.body[0].status === 'ACTIVE';
      });
      const plans = await api.getInstallmentPlans(token, orderId);
      const plan = plans.body[0];
      expect(plan.installments).toHaveLength(3);
      const sum = plan.installments.reduce((acc, i) => acc + i.amountCents, 0);
      expect(sum).toBe(product.priceCents);

      // notification-service reacts to the order.created event (via Kafka -> RabbitMQ).
      await waitUntil(async () => {
        const res = await api.getNotifications(token, userId);
        return res.body.some((n) => n.template === 'order_confirmation');
      });
    },
    30000,
  );
});
