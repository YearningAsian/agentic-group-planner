import "server-only";
import { NotBuiltError } from "@/lib/not-built";
import { createMockMerchant, type MockMerchant } from "./mock-merchant";
import type { BookingKind, BookingProvider } from "./types";

export type * from "./types";
export { MOCK_MERCHANT_NAME } from "./mock-merchant";

let merchant: MockMerchant | undefined;

/**
 * The booking adapter for a kind of purchase. Tickets always go to the mock merchant, in every
 * mode; stays (Duffel or its mock) aren't built yet. One merchant per process, so a simulated
 * price change reaches the next quote.
 */
export function getBookingProvider(kind: BookingKind): BookingProvider {
  if (kind === "tickets") return (merchant ??= createMockMerchant());
  throw new NotBuiltError(`The ${kind} booking provider`);
}
