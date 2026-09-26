import { AppError } from "@/lib/reliability";

/** A calendar date in `timeZone`, as YYYY-MM-DD. */
function localDate(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * A hotel stay's check-in and check-out dates in the trip's time zone. Hotels book nights by local
 * date, and a trip's evening check-in is often already the next day in UTC, so every place that
 * searches, caches, or checks a stay uses these dates.
 */
export function stayDates(startsAt: string, endsAt: string, timeZone: string): { checkIn: string; checkOut: string } {
  const checkIn = localDate(startsAt, timeZone);
  const checkOut = localDate(endsAt, timeZone);
  if (checkOut <= checkIn) {
    throw new AppError("invalid_input", "A hotel stay needs at least one night between check-in and check-out.", { retryable: false });
  }
  return { checkIn, checkOut };
}
