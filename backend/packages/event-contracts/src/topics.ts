/**
 * Catalog of Kafka topics (immutable domain events).
 * Naming: <domain>.<entity>.<event>.v1
 */
export const KafkaTopics = {
  order: {
    created: 'order.order.created.v1',
    confirmed: 'order.order.confirmed.v1',
    cancelled: 'order.order.cancelled.v1',
    refunded: 'order.order.refunded.v1',
  },
  payment: {
    authorized: 'payment.transaction.authorized.v1',
    authorizationFailed: 'payment.transaction.authorization_failed.v1',
    captured: 'payment.transaction.captured.v1',
    captureFailed: 'payment.transaction.capture_failed.v1',
    voided: 'payment.transaction.voided.v1',
    partiallyRefunded: 'payment.transaction.partially_refunded.v1',
    refunded: 'payment.transaction.refunded.v1',
    disputeOpened: 'payment.transaction.dispute_opened.v1',
    disputeResolved: 'payment.transaction.dispute_resolved.v1',
    chargebackReceived: 'payment.transaction.chargeback_received.v1',
    cancelled: 'payment.transaction.cancelled.v1',
    installmentChargeCaptured: 'payment.installment_charge.captured.v1',
    installmentChargeFailed: 'payment.installment_charge.capture_failed.v1',
  },
  bnpl: {
    planCreated: 'bnpl.installment_plan.created.v1',
    planActivated: 'bnpl.installment_plan.activated.v1',
    planAdjusted: 'bnpl.installment_plan.adjusted.v1',
    planCancelled: 'bnpl.installment_plan.cancelled.v1',
    installmentDue: 'bnpl.installment.due.v1',
    installmentPaid: 'bnpl.installment.paid.v1',
    installmentOverdue: 'bnpl.installment.overdue.v1',
    installmentDefaulted: 'bnpl.installment.defaulted.v1',
  },
  cart: {
    checkedOut: 'cart.cart.checked_out.v1',
  },
  auth: {
    userRegistered: 'auth.user.registered.v1',
  },
} as const;

/** All the Kafka topics a wildcard consumer must know about (e.g. the Kafka->RabbitMQ bridge). */
export const ALL_KAFKA_TOPICS: string[] = Object.values(KafkaTopics).flatMap((group) =>
  Object.values(group),
);

/**
 * RabbitMQ exchanges/queues (point-to-point commands/tasks, with retry/DLQ).
 */
export const RabbitMqTopology = {
  exchange: 'commands',
  routingKeys: {
    emailSend: 'email.send',
    documentGenerateContract: 'document.generate_contract',
    webhookPaymentProcess: 'webhook.payment.process',
    paymentChargeInstallment: 'payment.charge_installment',
  },
  queues: {
    notificationsEmailSend: 'q.notifications.email.send',
    documentsGenerateContract: 'q.documents.generate_contract',
    paymentsWebhookProcess: 'q.payments.webhook.process',
    paymentsChargeInstallment: 'q.payments.charge_installment',
  },
} as const;
