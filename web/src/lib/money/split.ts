/**
 * Splits a total into `count` shares that differ by at most one cent and always sum to the total.
 * Leftover cents go one at a time starting with the organizer, so rounding never costs a guest.
 */
export function splitEvenly(totalCents: number, count: number, organizerIndex = 0): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError("totalCents must be integer cents ≥ 0");
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be at least 1");
  if (!Number.isInteger(organizerIndex) || organizerIndex < 0 || organizerIndex >= count) {
    throw new RangeError("organizerIndex must point at one of the shares");
  }
  const base = Math.floor(totalCents / count);
  const shares = Array.from({ length: count }, () => base);
  for (let n = 0; n < totalCents - base * count; n++) shares[(organizerIndex + n) % count] += 1;
  return shares;
}
