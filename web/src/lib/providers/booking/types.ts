import type { BookingProvider as BookingProviderId } from "@agp/shared";

export type BookingKind = "tickets" | "stays" | "restaurant";
export type { BookingProviderId };

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
  /** Stored on the booking and its card. */
  readonly id: BookingProviderId;
  /** What the approval card names as the merchant. */
  readonly merchantName: string;
  /** Whether `book()` refuses without a lead guest's name, email, and phone. */
  readonly needsGuest: boolean;
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
    /** The lead guest; stays need one, tickets don't. */
    guest?: { givenName: string; familyName: string; email: string; phoneNumber: string };
    idempotencyKey: string;
  }): Promise<BookResult>;
  cancel(input: { providerRef: string; idempotencyKey: string }): Promise<{ status: "cancelled" }>;
  /** Mock merchant only; the dev toolbar uses it. */
  simulatePriceChange?(input: { quoteId: string; newTotalCents: number }): Promise<{ quoteId: string }>;
}
