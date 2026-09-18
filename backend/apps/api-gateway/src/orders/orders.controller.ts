import { createProxyController } from '../proxy/create-proxy-controller';

/** Always protected. order-service's routes already match this mount segment, so strip only /api. */
export const OrdersController = createProxyController('orders', 'ORDER_SERVICE_URL', 'http://localhost:3004');
