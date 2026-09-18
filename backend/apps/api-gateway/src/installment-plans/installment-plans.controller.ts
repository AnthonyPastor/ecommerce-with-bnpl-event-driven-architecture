import { createProxyController } from '@gateway/proxy/create-proxy-controller';

/** Always protected. bnpl-service's routes already match this mount segment, so strip only /api. */
export const InstallmentPlansController = createProxyController(
  'installment-plans',
  'BNPL_SERVICE_URL',
  'http://localhost:3006',
);
