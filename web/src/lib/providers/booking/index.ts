import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { NotBuiltError } from "@/lib/not-built";
import { createMockMerchant, type MockMerchant } from "./mock-merchant";
import { createDuffelStaysProvider } from "./stays-real";
import type { BookingKind, BookingProvider } from "./types";

export type * from "./types";
export { MOCK_MERCHANT_NAME } from "./mock-merchant";

/** Picks the hotel adapter from `STAYS_PROVIDER`. Pure, so tests can pass any env. */
export function selectStaysProvider(
  env: Pick<ServerEnv, "STAYS_PROVIDER"> & Partial<Pick<ServerEnv, "DUFFEL_ACCESS_TOKEN">>,
): BookingProvider {
  if (env.STAYS_PROVIDER === "mock") return createMockMerchant({ kind: "stays" });
  return createDuffelStaysProvider({ token: env.DUFFEL_ACCESS_TOKEN });
}

let merchant: MockMerchant | undefined;
let stays: BookingProvider | undefined;

/**
 * The booking adapter for a kind of purchase. Tickets always go to the mock merchant, in every
 * mode; stays go to Duffel or the hotel mock. One instance per process, so a simulated price
 * change reaches the next quote.
 */
export function getBookingProvider(kind: BookingKind): BookingProvider {
  if (kind === "tickets") return (merchant ??= createMockMerchant());
  if (kind === "stays") return (stays ??= selectStaysProvider(getServerEnv()));
  throw new NotBuiltError(`The ${kind} booking provider`);
}
