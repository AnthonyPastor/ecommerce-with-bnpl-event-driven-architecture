import { createProxyController } from '@gateway/proxy/create-proxy-controller';

/** Always protected — operates on the authenticated user's own data. cart-service's routes already match this mount segment, so strip only /api. */
export const CartController = createProxyController('cart', 'CART_SERVICE_URL', 'http://localhost:3003');
