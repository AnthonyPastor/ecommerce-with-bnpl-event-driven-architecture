export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'AUTHORIZATION_FAILED'
  | 'CAPTURED'
  | 'CAPTURE_FAILED'
  | 'VOIDED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'CHARGEBACK'
  | 'CANCELLED';

export type PaymentMethod = 'FULL' | 'INSTALLMENTS';

export interface Transaction {
  id: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  gatewayProvider: string;
  gatewayReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InstallmentStatus = 'PENDING' | 'DUE' | 'PAID' | 'OVERDUE' | 'DEFAULTED' | 'CANCELLED';

export interface Installment {
  id: string;
  installmentNumber: number;
  amountCents: number;
  dueDate: string;
  status: InstallmentStatus;
}

export type InstallmentPlanStatus = 'PENDING' | 'ACTIVE' | 'ADJUSTED' | 'CANCELLED' | 'DISPUTED_HOLD';

export interface InstallmentPlan {
  id: string;
  orderId: string;
  userId: string;
  totalCents: number;
  currency: string;
  installmentsCount: number;
  status: InstallmentPlanStatus;
  installments: Installment[];
}
