export type BookingKind = "tickets" | "stays" | "restaurant";

export interface Quote {
  quoteId: string;
  totalCents: number;
  currency: string;
  expiresAt: string;
}

export interface BookResult {
  status: "confirmed" | "failed";
  providerRef: string | null;
  confirmationCode?: string;
  failureReason?: string;
}

export interface BookingProvider {
  quote(input: {
    kind: BookingKind;
    placeId: string;
    optionId: string;
    partySize: number;
    startsAt: string;
  }): Promise<Quote>;
  book(input: {
    kind: BookingKind;
    quoteId?: string;
    reservation?: { confirmedTime: string; notes?: string };
    partySize: number;
    startsAt: string;
    contactName: string;
    idempotencyKey: string;
  }): Promise<BookResult>;
  cancel(input: { providerRef: string; idempotencyKey: string }): Promise<{ status: "cancelled" }>;
  /** Mock merchant only; the dev toolbar uses it. */
  simulatePriceChange?(input: { quoteId: string; newTotalCents: number }): Promise<{ quoteId: string }>;
}
