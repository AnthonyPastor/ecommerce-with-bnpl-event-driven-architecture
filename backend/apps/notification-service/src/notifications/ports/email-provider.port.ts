export interface SendEmailInput {
  to: string;
  template: string;
  data: Record<string, unknown>;
}

/**
 * Puerto abstracto del proveedor de email — repository pattern para poder
 * swappear la implementación (console -> SendGrid/SES) sin tocar el resto
 * del sistema. DI vía token explícito (EMAIL_PROVIDER).
 */
export abstract class EmailProviderPort {
  abstract send(input: SendEmailInput): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
