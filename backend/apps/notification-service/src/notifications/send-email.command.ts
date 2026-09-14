export interface SendEmailCommand {
  to: string;
  template: string;
  data: Record<string, unknown>;
}
