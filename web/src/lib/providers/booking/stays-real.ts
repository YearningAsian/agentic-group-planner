import "server-only";
import { Duffel, DuffelError } from "@duffel/api";
import { decimalToCents } from "@agp/shared";
import { AppError, withPolicy, type Policy } from "@/lib/reliability";
import type { BookingProvider, BookResult, Quote } from "./types";

/** The slice of the Duffel client this adapter calls, so tests can pass a double. */
export interface DuffelStaysClient {
  quotes: Pick<Duffel["stays"]["quotes"], "create">;
  bookings: Pick<Duffel["stays"]["bookings"], "create" | "listWithGenerator" | "get" | "cancel">;
}

export interface DuffelStaysProviderOptions {
  token?: string;
  client?: DuffelStaysClient;
  now?: () => number;
  /** Waits between lookups after an ambiguous create; tests pass zeros. */
  lookupDelaysMs?: readonly number[];
}

// Our approval window only: Duffel's quote has no expiry field, and the rate behind it can lapse
// sooner, in which case the booking is rejected and the holds are released.
const QUOTE_TTL_MS = 10 * 60_000;
const KEY_FIELD = "agp_idempotency_key";
// The SDK has no timeout or abort; a timed-out create keeps running at Duffel, and it is never
// retried because Stays bookings take no idempotency key.
const READ_POLICY: Policy = { timeoutMs: 15_000, retries: 1 };
const CREATE_POLICY: Policy = { timeoutMs: 30_000, retries: 0 };
const SCAN_POLICY: Policy = { timeoutMs: 60_000, retries: 1 };
const LOOKUP_DELAYS_MS = [0, 2_000, 5_000, 10_000] as const;

function statusOf(error: InstanceType<typeof DuffelError>): number | undefined {
  return error.status ?? error.meta?.status;
}

/** Duffel's error code when it refused the request itself (a 4xx other than auth or rate limits). */
function rejectionCode(error: unknown): string | null {
  const cause = error instanceof AppError ? error.cause : error;
  if (!(cause instanceof DuffelError)) return null;
  const status = statusOf(cause);
  if (status === undefined || status === 401 || status === 403 || status === 429 || status >= 500) return null;
  return cause.errors?.[0]?.code ?? "rejected";
}

async function duffelCall<T>(call: () => Promise<T>, policy: Policy): Promise<T> {
  try {
    return await withPolicy(() => call(), policy);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof DuffelError && (statusOf(error) === 401 || statusOf(error) === 403)) {
      throw new AppError("internal", "The hotel provider refused our credentials.", { retryable: false, cause: error });
    }
    const code = rejectionCode(error);
    if (code) throw new AppError("conflict", `The hotel provider refused the request (${code}).`, { retryable: false, cause: error });
    throw new AppError("provider_unavailable", "The hotel provider isn't responding. Try again.", { retryable: true, cause: error });
  }
}

function assertStays(kind: string): void {
  if (kind !== "stays") throw new AppError("invalid_input", "Duffel Stays books hotels only.", { retryable: false });
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Hotels through Duffel Stays (design §2.3). Our `optionId` is Duffel's `rate_id` from a stays
 * search; `quote()` confirms the rate's price, `book()` buys the quote for a lead guest. Duffel
 * sends money as decimal strings, and only USD matches the mandates we charge.
 */
export function createDuffelStaysProvider(options: DuffelStaysProviderOptions): BookingProvider {
  const now = options.now ?? Date.now;
  const lookupDelays = options.lookupDelaysMs ?? LOOKUP_DELAYS_MS;
  const client =
    options.client ??
    (() => {
      if (!options.token) throw new AppError("internal", "DUFFEL_ACCESS_TOKEN is missing.", { retryable: false });
      return new Duffel({ token: options.token }).stays;
    })();

  // Duffel doesn't document the list order, so every page is read until our key turns up.
  async function findBooking(idempotencyKey: string): Promise<BookResult | null> {
    return duffelCall(async () => {
      for await (const { data } of client.bookings.listWithGenerator()) {
        if (data.metadata?.[KEY_FIELD] === idempotencyKey) return outcome(data);
      }
      return null;
    }, SCAN_POLICY);
  }

  async function findBookingPatiently(idempotencyKey: string): Promise<BookResult | null> {
    for (const delay of lookupDelays) {
      await sleep(delay);
      const found = await findBooking(idempotencyKey);
      if (found) return found;
    }
    return null;
  }

  // A booking found cancelled counts as failed, so the mandate is cancelled and its holds released.
  function outcome(booking: { id: string; status: string; reference: string | null }): BookResult {
    if (booking.status !== "confirmed") return { status: "failed", providerRef: booking.id, failureReason: booking.status };
    return { status: "confirmed", providerRef: booking.id, ...(booking.reference ? { confirmationCode: booking.reference } : {}) };
  }

  return {
    id: "duffel_stays",
    merchantName: "Duffel Stays",
    needsGuest: true,

    async quote(input): Promise<Quote> {
      assertStays(input.kind);
      const { data } = await duffelCall(() => client.quotes.create(input.optionId), READ_POLICY).catch((error: unknown) => {
        if (rejectionCode(error)) {
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
      // The group approves one total; a fee owed at the hotel would be a charge they never saw.
      if (data.due_at_accommodation_amount && decimalToCents(data.due_at_accommodation_amount) > 0) {
        throw new AppError("conflict", "That rate adds fees paid at the hotel; pick another rate.", { retryable: false });
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
        return outcome(data);
      } catch (error) {
        const code = rejectionCode(error);
        if (code) {
          // A retry's quote may be spent because an earlier, timed-out attempt booked it.
          return (await findBooking(idempotencyKey)) ?? { status: "failed", providerRef: null, failureReason: code };
        }
        if (error instanceof AppError && !error.retryable) throw error;
        const landed = await findBookingPatiently(idempotencyKey);
        if (landed) return landed;
        throw error;
      }
    },

    async cancel({ providerRef }) {
      try {
        await duffelCall(() => client.bookings.cancel(providerRef), READ_POLICY);
      } catch (error) {
        if (!rejectionCode(error)) throw error;
        const { data } = await duffelCall(() => client.bookings.get(providerRef), READ_POLICY);
        if (data.status !== "cancelled") {
          throw new AppError("conflict", "The hotel booking can't be cancelled.", { retryable: false, cause: error });
        }
      }
      return { status: "cancelled" };
    },
  };
}
