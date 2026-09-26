export type PaymentsProviderName = "real" | "mock";

export interface AuthorizeInput {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  /** `pi-auth:{mandate_id}:{payer_member_id}`, plus `:cover:{share_member_id}` for a cover hold (features/payments/lib/hold). */
  idempotencyKey: string;
}

/** A provider event, normalized: only what the handlers need, never card data. */
export interface PaymentsEvent {
  id: string;
  type: string;
  paymentIntentId: string | null;
  status: string | null;
  /** The PaymentIntent's metadata (`mandate_id`, `payer_member_id`, `trip_id`, and a cover hold's `cover_share_member_id`), or the charge's. */
  metadata: Record<string, string>;
  /** Set on a failed payment that the card issuer declined. */
  declineCode: string | null;
  /** `charge.refunded` (legacy) or `refund.created` / `refund.updated`: each refund names the fronted share. */
  refunds: { id: string; amountCents: number; metadata: Record<string, string> }[];
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
  /** `metadata` names the fronted share (`mandate_id`, `share_member_id`), so its webhook finds the row. */
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ refundId: string }>;
  /** Verifies the signature against the raw body; throws when it doesn't match. */
  parseWebhook(input: { rawBody: string; signature: string }): PaymentsEvent;
}
