const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * A provider's decimal amount string ("123.45") as integer cents, parsed without floats. Only
 * two-decimal currencies fit; anything else, or an amount past the safe integer range, throws.
 */
export function decimalToCents(amount: string): number {
  const [, whole, fraction = ""] = DECIMAL.exec(amount) ?? [];
  if (whole === undefined) throw new RangeError(`Not a decimal amount: ${JSON.stringify(amount)}`);
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`Amount too large: ${amount}`);
  return Number(cents);
}
