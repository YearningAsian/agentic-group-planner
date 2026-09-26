export type PaymentsProviderName = "real" | "mock";

export interface AuthorizeInput {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  /** `pi-auth:{mandate_id}:{payer_member_id}` */
  idempotencyKey: string;
}

export interface PaymentsEvent {
  id: string;
  type: string;
  paymentIntentId: string | null;
  status: string | null;
}

export interface PaymentsProvider {
  readonly name: PaymentsProviderName;
  ensureCustomer(input: { profileId: string; email?: string; name: string }): Promise<{ customerId: string }>;
  attachTestCard(input: { customerId: string; card: "visa" | "declined" }): Promise<{ paymentMethodId: string }>;
  authorize(input: AuthorizeInput): Promise<{
    paymentIntentId: string;
    status: "authorized" | "declined" | "failed";
    declineCode?: string;
  }>;
  capture(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<{
    status: "captured";
    capturedCents: number;
  }>;
  release(input: { paymentIntentId: string; idempotencyKey: string }): Promise<{ status: "released" }>;
  refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<{ refundId: string }>;
  /** Verifies the signature against the raw body; throws when it doesn't match. */
  parseWebhook(input: { rawBody: string; signature: string }): PaymentsEvent;
}
