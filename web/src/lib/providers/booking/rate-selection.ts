import "server-only";
import { AppError } from "@/lib/reliability";
import { stayDates } from "./stay-dates";

/** How long before a Duffel rate expires the group's approvals must be in. */
const RATE_MARGIN_MS = 10 * 60_000;
/** The shortest approval window worth opening; a rate expiring sooner isn't offered or proposed. */
const MIN_APPROVAL_MS = 15 * 60_000;
/** The usual approval window (design §2.1). */
const APPROVAL_WINDOW_MS = 24 * 60 * 60_000;
/** A rate must outlive this to be offered at all: the margin plus the shortest approval window. */
export const MIN_RATE_LIFETIME_MS = RATE_MARGIN_MS + MIN_APPROVAL_MS;

interface Selection {
  bookingProvider: string;
  optionId: string;
  place: { provider: string; raw: unknown } | null;
  itemId: string;
  tripId: string;
  startsAt: string;
  endsAt: string;
  guests: number;
  /** The trip's time zone; stays are matched by local dates. */
  timezone: string;
  now: number;
}

const stale = () => new AppError("conflict", "This hotel rate is no longer valid for the trip. Search stays again.", { retryable: false });

/** Maps an internal option to its selected Duffel rate, bound to this item's search scope. */
export function bookingOptionId(input: Selection): string {
  // A Duffel rate booked through another merchant would sell a room nobody quoted.
  if (input.bookingProvider !== "duffel_stays") {
    if (input.place?.provider === "duffel_stays") throw stale();
    return input.optionId;
  }
  const raw = input.place?.raw as Record<string, unknown> | null | undefined;
  const total = raw?.total_cents;
  const price = raw?.price_cents;
  const expiry = typeof raw?.expires_at === "string" ? Date.parse(raw.expires_at) : NaN;
  const rate = raw?.rate_id;
  let dates: { checkIn: string; checkOut: string };
  try {
    dates = stayDates(input.startsAt, input.endsAt, input.timezone);
  } catch {
    throw stale();
  }
  if (input.place?.provider !== "duffel_stays" || typeof rate !== "string" || !rate.startsWith("rat_") ||
    raw?.item_id !== input.itemId || raw?.trip_id !== input.tripId ||
    raw?.check_in_date !== dates.checkIn || raw?.check_out_date !== dates.checkOut ||
    raw?.guests !== input.guests || !Number.isInteger(total) || !Number.isInteger(price) ||
    (total as number) < 1 || price !== Math.ceil((total as number) / input.guests) || !(expiry > input.now)) {
    throw stale();
  }
  return rate;
}

/**
 * When a purchase stops collecting approvals: the usual 24 hours, but for a Duffel rate, ten
 * minutes before the rate expires, so a finished approval can still be quoted. A rate leaving
 * less than 15 minutes to approve is refused.
 */
export function approvalDeadline(input: { now: number; rateExpiresAt?: string | null }): string {
  let deadline = input.now + APPROVAL_WINDOW_MS;
  if (input.rateExpiresAt) {
    const rateDeadline = Date.parse(input.rateExpiresAt) - RATE_MARGIN_MS;
    if (!(rateDeadline - input.now >= MIN_APPROVAL_MS)) {
      throw new AppError("conflict", "This hotel rate expires too soon to collect everyone's approval. Search stays again.", { retryable: false });
    }
    deadline = Math.min(deadline, rateDeadline);
  }
  return new Date(deadline).toISOString();
}
