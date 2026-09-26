/**
 * Splits a total into `count` shares as evenly as whole cents allow. Every leftover cent goes to
 * the organizer's share (design §2.1), so the shares always add back up to the total.
 *
 * @param totalCents the whole amount, in integer cents
 * @param count how many attendees share it
 * @param organizerIndex which share absorbs the leftover cents; defaults to the first
 */
export function splitEvenly(totalCents: number, count: number, organizerIndex = 0): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError("totalCents must be integer cents ≥ 0");
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
  if (!Number.isInteger(organizerIndex) || organizerIndex < 0 || organizerIndex >= count) {
    throw new RangeError("organizerIndex must point at one of the shares");
  }
  const leftover = totalCents % count;
  // Exact: the dividend is a multiple of count, so no float rounding is involved.
  const base = (totalCents - leftover) / count;
  const shares = Array.from({ length: count }, () => base);
  shares[organizerIndex]! += leftover;
  return shares;
}
