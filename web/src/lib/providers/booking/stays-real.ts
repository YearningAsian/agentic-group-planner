import "server-only";
import { Duffel, DuffelError } from "@duffel/api";
import { decimalToCents } from "@agp/shared";
import { AppError, withPolicy, type Policy } from "@/lib/reliability";
import type { BookingProvider, BookResult, Quote } from "./types";

/** The slice of the Duffel client this adapter calls, so tests can pass a double. */
export interface DuffelStaysClient {
  quotes: Pick<Duffel["stays"]["quotes"], "create">;
  bookings: Pick<Duffel["stays"]["bookings"], "create" | "list" | "get" | "cancel">;
}

export interface DuffelStaysProviderOptions {
  token?: string;
  client?: DuffelStaysClient;
  now?: () => number;
}

// Duffel's quotes carry no expiry, so the approval window is ours.
const QUOTE_TTL_MS = 10 * 60_000;
const KEY_FIELD = "agp_idempotency_key";
// The SDK has no timeout setting; a create is never retried because Duffel has no idempotency key.
const READ_POLICY: Policy = { timeoutMs: 15_000, retries: 1 };
const CREATE_POLICY: Policy = { timeoutMs: 30_000, retries: 0 };
// Only the newest page is searched for a retried booking; a retry comes minutes after the first try.
const LOOKUP_LIMIT = 200;

function rejection(error: unknown): { code: string } | null {
  if (!(error instanceof DuffelError)) return null;
  const status = error.status ?? error.meta?.status;
  if (status === undefined || status === 429 || status >= 500) return null;
  return { code: error.errors[0]?.code ?? "rejected" };
}

async function duffelCall<T>(call: () => Promise<T>, policy: Policy): Promise<T> {
  try {
    return await withPolicy(() => call(), policy);
  } catch (error) {
    if (error instanceof AppError || rejection(error)) throw error;
    throw new AppError("provider_unavailable", "The hotel provider isn't responding. Try again.", { retryable: true, cause: error });
  }
}

function assertStays(kind: string): void {
  if (kind !== "stays") throw new AppError("invalid_input", "Duffel Stays books hotels only.", { retryable: false });
}

/**
 * Hotels through Duffel Stays (design §2.3). Our `optionId` is Duffel's `rate_id` from a stays
 * search; `quote()` confirms the rate's price, `book()` buys the quote for a lead guest. Duffel
 * sends money as decimal strings, and only USD matches the mandates we charge.
 */
export function createDuffelStaysProvider(options: DuffelStaysProviderOptions): BookingProvider {
  const now = options.now ?? Date.now;
  const client =
    options.client ??
    (() => {
      if (!options.token) throw new AppError("invalid_input", "DUFFEL_ACCESS_TOKEN is missing.", { retryable: false });
      return new Duffel({ token: options.token }).stays;
    })();

  async function findBooking(idempotencyKey: string): Promise<BookResult | null> {
    const { data } = await duffelCall(() => client.bookings.list({ limit: LOOKUP_LIMIT }), READ_POLICY);
    const found = data.find((b) => b.metadata?.[KEY_FIELD] === idempotencyKey);
    return found ? confirmed(found) : null;
  }

  function confirmed(booking: { id: string; status: string; reference: string | null }): BookResult {
    if (booking.status !== "confirmed") return { status: "failed", providerRef: booking.id, failureReason: booking.status };
    return { status: "confirmed", providerRef: booking.id, ...(booking.reference ? { confirmationCode: booking.reference } : {}) };
  }

  return {
    async quote(input): Promise<Quote> {
      assertStays(input.kind);
      const { data } = await duffelCall(() => client.quotes.create(input.optionId), READ_POLICY).catch((error: unknown) => {
        if (rejection(error)) {
          throw new AppError("conflict", "That room rate is no longer available.", { retryable: false, cause: error });
        }
        throw error;
      });
      if (data.total_currency !== "USD") {
        throw new AppError("invalid_input", "Only hotels priced in USD can be booked.", { retryable: false });
      }
      if (data.guests.length !== input.partySize) {
        throw new AppError("invalid_input", `That rate is for ${data.guests.length} guests, not ${input.partySize}.`, { retryable: false });
      }
      return {
        quoteId: data.id,
        totalCents: decimalToCents(data.total_amount),
        currency: "usd",
        expiresAt: new Date(now() + QUOTE_TTL_MS).toISOString(),
      };
    },

    async book(input): Promise<BookResult> {
      assertStays(input.kind);
      const { quoteId, guest, idempotencyKey } = input;
      if (!quoteId || !guest) {
        throw new AppError("invalid_input", "A hotel booking needs a quote and a lead guest.", { retryable: false });
      }
      const existing = await findBooking(idempotencyKey);
      if (existing) return existing;
      try {
        const { data } = await duffelCall(
          () =>
            client.bookings.create({
              quote_id: quoteId,
              guests: [{ given_name: guest.givenName, family_name: guest.familyName }],
              email: guest.email,
              phone_number: guest.phoneNumber,
              metadata: { [KEY_FIELD]: idempotencyKey },
            }),
          CREATE_POLICY,
        );
        return confirmed(data);
      } catch (error) {
        const rejected = rejection(error);
        if (rejected) return { status: "failed", providerRef: null, failureReason: rejected.code };
        // A timeout or 5xx may still have booked the room.
        const landed = await findBooking(idempotencyKey);
        if (landed) return landed;
        throw error;
      }
    },

    async cancel({ providerRef }) {
      try {
        await duffelCall(() => client.bookings.cancel(providerRef), READ_POLICY);
      } catch (error) {
        if (!rejection(error)) throw error;
        const { data } = await duffelCall(() => client.bookings.get(providerRef), READ_POLICY);
        if (data.status !== "cancelled") {
          throw new AppError("conflict", "The hotel booking can't be cancelled.", { retryable: false, cause: error });
        }
      }
      return { status: "cancelled" };
    },
  };
}
