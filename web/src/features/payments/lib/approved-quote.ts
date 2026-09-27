import { AppError } from "@/lib/reliability";

export type QuoteChangeReason = "price_changed" | "price_above_cap";

/** A capture plan is fixed at approval time, so a changed merchant quote needs a new mandate. */
export function quoteChangeReason(input: {
  approvedCents: number;
  capCents: number;
  currency: string;
  currentCents: number;
  currentCurrency: string;
}): QuoteChangeReason | null {
  if (!Number.isSafeInteger(input.currentCents) || input.currentCents < 0) {
    throw new AppError("provider_unavailable", "The merchant returned an invalid price.");
  }
  if (input.currentCurrency !== input.currency) return "price_changed";
  // The cap includes fees, while the merchant quote does not. This comparison only identifies
  // prices definitely above the cap; being below it never authorizes a different base price.
  if (input.currentCents > input.capCents) return "price_above_cap";
  return input.currentCents === input.approvedCents ? null : "price_changed";
}
