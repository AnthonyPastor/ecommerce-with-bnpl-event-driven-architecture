import { createProxyController } from '../proxy/create-proxy-controller';

/** Always protected. payment-service's routes already match this mount segment, so strip only /api. Webhooks bypass this gateway entirely. */
export const PaymentsController = createProxyController('payments', 'PAYMENT_SERVICE_URL', 'http://localhost:3005');
