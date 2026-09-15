export interface SendEmailInput {
  to: string;
  template: string;
  data: Record<string, unknown>;
}

/**
 * Abstract email provider port — repository pattern so the implementation
 * can be swapped (console -> SendGrid/SES) without touching the rest of
 * the system. DI via an explicit token (EMAIL_PROVIDER).
 */
export abstract class EmailProviderPort {
  abstract send(input: SendEmailInput): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
