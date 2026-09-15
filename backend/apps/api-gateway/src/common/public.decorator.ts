import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route (or an entire controller) as not requiring a JWT — see GatewayAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
