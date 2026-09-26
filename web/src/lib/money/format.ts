/**
 * "$94" for whole dollars and "$42.50" otherwise, built from integer cents so no float ever
 * touches the amount. A negative amount (a refund) reads "-$42.50".
 */
export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("formatUsd takes integer cents");
  const sign = cents < 0 ? "-" : "";
  const magnitude = Math.abs(cents);
  const dollars = Math.floor(magnitude / 100).toLocaleString("en-US");
  const remainder = magnitude % 100;
  return `${sign}$${dollars}${remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`}`;
}
