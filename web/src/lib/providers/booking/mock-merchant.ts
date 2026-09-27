import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import type { BookingKind, BookingProvider, BookResult, Quote } from "./types";

/** What the approval card names as the merchant. */
export const MOCK_MERCHANT_NAME = "Demo Tickets (mock merchant)";
const MOCK_HOTELS_NAME = "Demo Hotels (mock merchant)";

const QUOTE_TTL_MS = 15 * 60_000;
const QUOTE_PREFIX = "q_mock_";

/** Everything `book()` needs, carried inside the quote ID. */
const QuoteState = z.object({
  optionId: z.string(),
  placeId: z.string(),
  partySize: z.number().int().min(1),
  startsAt: z.string(),
  totalCents: z.number().int().min(0),
  expiresAt: z.string(),
});
type QuoteState = z.infer<typeof QuoteState>;

export type MockMerchant = BookingProvider & Required<Pick<BookingProvider, "simulatePriceChange">>;

export interface MockMerchantOptions {
  /** A ticket's price; defaults to `item_options.price_cents`, read with the admin client. */
  priceOf?: (input: { optionId: string; placeId: string }) => Promise<number>;
  now?: () => number;
  /** What it sells; `stays` is the hotel mock (`STAYS_PROVIDER=mock`). */
  kind?: Extract<BookingKind, "tickets" | "stays">;
}

async function optionPrice({ optionId, placeId }: { optionId: string; placeId: string }): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("item_options")
    .select("price_cents")
    .eq("id", optionId)
    .eq("place_id", placeId)
    .maybeSingle();
  if (error) throw new AppError("provider_unavailable", "The merchant couldn't look up the price.", { cause: error });
  if (!data) throw new AppError("not_found", "The merchant doesn't sell that option.");
  return data.price_cents;
}

// The quote travels inside its ID, so a quote made in one server process can be booked in another.
function encodeQuote(state: QuoteState): string {
  return QUOTE_PREFIX + Buffer.from(JSON.stringify(state)).toString("base64url");
}

function decodeQuote(quoteId: string): QuoteState | null {
  if (!quoteId.startsWith(QUOTE_PREFIX)) return null;
  try {
    const parsed = QuoteState.safeParse(JSON.parse(Buffer.from(quoteId.slice(QUOTE_PREFIX.length), "base64url").toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function digest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function assertKind(kind: BookingKind, sells: BookingKind): void {
  if (kind !== sells) throw new AppError("invalid_input", `The mock merchant sells ${sells} only.`);
}

/**
 * The ticket merchant (design §2.3), used in every mode. Prices come from `item_options`, a quote
 * is valid for 15 minutes, and a booking's reference derives from its idempotency key, so a
 * retried `book()` gets the same reference in any process. `simulatePriceChange` lets the dev
 * toolbar move the next quote for an option; that override lives in this process only.
 */
export function createMockMerchant(options: MockMerchantOptions = {}): MockMerchant {
  const priceOf = options.priceOf ?? optionPrice;
  const now = options.now ?? Date.now;
  const sells = options.kind ?? "tickets";
  const nextTotals = new Map<string, number>();
  const bookings = new Map<string, BookResult>();
  const overrideKey = (s: Pick<QuoteState, "optionId" | "partySize">) => `${s.optionId}:${s.partySize}`;

  return {
    id: sells === "stays" ? "stays_mock" : "mock_merchant",
    merchantName: sells === "stays" ? MOCK_HOTELS_NAME : MOCK_MERCHANT_NAME,
    needsGuest: false,

    async quote(input): Promise<Quote> {
      assertKind(input.kind, sells);
      if (!Number.isSafeInteger(input.partySize) || input.partySize < 1) {
        throw new AppError("invalid_input", "A quote needs a party of at least one.");
      }
      const key = overrideKey(input);
      const override = nextTotals.get(key);
      nextTotals.delete(key);
      const totalCents = override ?? (await priceOf({ optionId: input.optionId, placeId: input.placeId })) * input.partySize;
      const state: QuoteState = {
        optionId: input.optionId,
        placeId: input.placeId,
        partySize: input.partySize,
        startsAt: input.startsAt,
        totalCents,
        expiresAt: new Date(now() + QUOTE_TTL_MS).toISOString(),
      };
      return { quoteId: encodeQuote(state), totalCents, currency: "usd", expiresAt: state.expiresAt };
    },

    async book(input): Promise<BookResult> {
      assertKind(input.kind, sells);
      const previous = bookings.get(input.idempotencyKey);
      if (previous) return previous;

      const quote = input.quoteId ? decodeQuote(input.quoteId) : null;
      let result: BookResult;
      if (!quote) {
        result = { status: "failed", providerRef: null, failureReason: "unknown_quote" };
      } else if (now() > Date.parse(quote.expiresAt)) {
        result = { status: "failed", providerRef: null, failureReason: "quote_expired" };
      } else {
        const hash = digest(`booking:${input.idempotencyKey}`);
        result = {
          status: "confirmed",
          providerRef: `mock_bk_${hash.slice(0, 24)}`,
          confirmationCode: BigInt(`0x${hash.slice(24, 40)}`).toString(36).toUpperCase().padStart(6, "0").slice(-6),
        };
      }
      bookings.set(input.idempotencyKey, result);
      return result;
    },

    async cancel() {
      return { status: "cancelled" };
    },

    async simulatePriceChange({ quoteId, newTotalCents }) {
      const quote = decodeQuote(quoteId);
      if (!quote) throw new AppError("invalid_input", "That isn't a mock merchant quote.");
      if (!Number.isSafeInteger(newTotalCents) || newTotalCents < 0) {
        throw new AppError("invalid_input", "The new total must be integer cents ≥ 0.");
      }
      nextTotals.set(overrideKey(quote), newTotalCents);
      return { quoteId };
    },
  };
}
