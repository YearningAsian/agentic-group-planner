const dollarsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Formats integer cents as US dollars: whole dollars drop the cents ("$94"), anything else shows
 * two digits ("$42.50"). Integer math only, so no amount ever passes through a float.
 */
export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("amounts must be integer cents");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const remainder = abs % 100;
  const dollars = dollarsFormat.format((abs - remainder) / 100);
  return remainder === 0 ? `${sign}$${dollars}` : `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}
