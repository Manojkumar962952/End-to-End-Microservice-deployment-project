export interface BaseDomainEvent<T> {
  eventId: string;
  eventType: string;
  timestamp: string;
  correlationId: string;
  payload: T;
}

// Event Types
export const EventTypes = {
  ORDER_CREATED: 'order.created',
  INVENTORY_RESERVED: 'inventory.reserved',
  INVENTORY_FAILED: 'inventory.failed',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed'
} as const;

export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  totalCents: number;
  currency: string;
}
export type OrderCreatedEvent = BaseDomainEvent<OrderCreatedPayload>;

export interface InventoryReservedPayload {
  orderId: string;
  reservationId: string;
}
export type InventoryReservedEvent = BaseDomainEvent<InventoryReservedPayload>;

export interface InventoryFailedPayload {
  orderId: string;
  reason: string;
}
export type InventoryFailedEvent = BaseDomainEvent<InventoryFailedPayload>;

export interface PaymentSucceededPayload {
  orderId: string;
  paymentId: string;
  transactionRef: string;
  amountCents: number;
}
export type PaymentSucceededEvent = BaseDomainEvent<PaymentSucceededPayload>;

export interface PaymentFailedPayload {
  orderId: string;
  reason: string;
}
export type PaymentFailedEvent = BaseDomainEvent<PaymentFailedPayload>;
