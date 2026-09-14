import { api, registerAndLogin, waitUntil } from './client';

// Suite de sistema: asume que `docker compose -f backend/infra/docker-compose.yml
// up -d` y los 8 servicios (`pnpm --filter <service> start:dev` o el build +
// `node dist/main.js` de cada uno) ya están corriendo, con el api-gateway en
// GATEWAY_URL (default http://localhost:3000/api). No levanta nada por sí
// misma — es la suite que ejercita el sistema COMPLETO end-to-end, a
// diferencia de los e2e por-servicio que corren cada uno aislado.
describe('BNPL happy path (sistema completo)', () => {
  it(
    'registro -> catálogo -> carrito -> checkout -> pago -> captura -> plan de cuotas -> notificación',
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

      // El webhook async del FakePaymentGateway confirma la captura ~2s después.
      await waitUntil(async () => {
        const res = await api.getPayment(token, transactionId);
        return res.body.status === 'CAPTURED';
      });

      // bnpl-service reacciona al evento captured (vía Kafka) creando el plan.
      await waitUntil(async () => {
        const res = await api.getInstallmentPlans(token, orderId);
        return res.body.length > 0 && res.body[0].status === 'ACTIVE';
      });
      const plans = await api.getInstallmentPlans(token, orderId);
      const plan = plans.body[0];
      expect(plan.installments).toHaveLength(3);
      const sum = plan.installments.reduce((acc, i) => acc + i.amountCents, 0);
      expect(sum).toBe(product.priceCents);

      // notification-service reacciona al evento order.created (vía Kafka -> RabbitMQ).
      await waitUntil(async () => {
        const res = await api.getNotifications(token, userId);
        return res.body.some((n) => n.template === 'order_confirmation');
      });
    },
    30000,
  );
});
