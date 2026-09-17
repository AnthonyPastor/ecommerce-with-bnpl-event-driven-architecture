import { createProxyController } from '../proxy/create-proxy-controller';

/** Always protected. notification-service's routes already match this mount segment, so strip only /api. */
export const NotificationsController = createProxyController(
  'notifications',
  'NOTIFICATION_SERVICE_URL',
  'http://localhost:3007',
);
