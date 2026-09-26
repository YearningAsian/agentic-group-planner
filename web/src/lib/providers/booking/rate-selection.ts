import "server-only";
import { AppError } from "@/lib/reliability";

interface Selection {
  bookingProvider: string;
  optionId: string;
  place: { provider: string; raw: unknown } | null;
  itemId: string;
  tripId: string;
  startsAt: string;
  endsAt: string;
  guests: number;
  now: number;
}

/** Maps an internal option to its selected Duffel rate, bound to this item's search scope. */
export function bookingOptionId(input: Selection): string {
  if (input.bookingProvider !== "duffel_stays") return input.optionId;
  const raw = input.place?.raw as Record<string, unknown> | null | undefined;
  const total = raw?.total_cents;
  const price = raw?.price_cents;
  const expiry = typeof raw?.expires_at === "string" ? Date.parse(raw.expires_at) : NaN;
  const rate = raw?.rate_id;
  if (input.place?.provider !== "duffel_stays" || typeof rate !== "string" || !rate.startsWith("rat_") ||
    raw?.item_id !== input.itemId || raw?.trip_id !== input.tripId ||
    raw?.check_in_date !== input.startsAt.slice(0, 10) || raw?.check_out_date !== input.endsAt.slice(0, 10) ||
    raw?.guests !== input.guests || !Number.isInteger(total) || !Number.isInteger(price) ||
    (total as number) < 1 || price !== Math.ceil((total as number) / input.guests) || !(expiry > input.now)) {
    throw new AppError("conflict", "This hotel rate is no longer valid for the trip. Search stays again.", { retryable: false });
  }
  return rate;
}
