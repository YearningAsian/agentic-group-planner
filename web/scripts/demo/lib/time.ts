/** The date (YYYY-MM-DD) that an instant falls on in a time zone. */
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** How far a time zone's wall clock is ahead of UTC at an instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((wall - instant.getTime()) / 60_000);
}

/** The Saturday after `now` in the trip's time zone (a week out when it's Saturday already), as YYYY-MM-DD. */
export function nextSaturday(now: Date, timeZone: string): string {
  const today = localDate(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`);
  const ahead = (6 - day.getUTCDay() + 7) % 7 || 7;
  day.setUTCDate(day.getUTCDate() + ahead);
  return day.toISOString().slice(0, 10);
}

/** A wall-clock time on a date in a time zone, as a UTC ISO instant. */
export function localToUtc(date: string, time: string, timeZone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  // Two passes settle the offset even when the guess lands on the other side of a DST change.
  let instant = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
  instant = new Date(guess.getTime() - offsetMinutes(instant, timeZone) * 60_000);
  return instant.toISOString();
}
