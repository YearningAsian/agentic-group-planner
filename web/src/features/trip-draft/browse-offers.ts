import type { FlightOffer } from "@/lib/providers/flights/types";
import type { StayCard } from "@/lib/providers/stays/types";
import { stayOverBudget } from "@/features/trip-draft/format";

/** Session origin captured from a Duffel flight search in chat. */
export const FLIGHT_ORIGIN_KEY = "planner-flight-origin";

export function rememberFlightOrigin(origin: string) {
  const trimmed = origin.trim();
  if (!trimmed || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(FLIGHT_ORIGIN_KEY, trimmed);
}

export function rememberedFlightOrigin(): string {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(FLIGHT_ORIGIN_KEY)?.trim() ?? "";
}

export function stayExceedsBudget(card: StayCard, nights: number, budget: number | null): boolean {
  if (card.nightlyAmount == null || !budgetCurrency(card.currency)) return false;
  return stayOverBudget(card.nightlyAmount, nights, budget);
}

export function flightExceedsBudget(flight: FlightOffer, budget: number | null): boolean {
  if (!budgetCurrency(flight.currency)) return false;
  if (budget == null) return false;
  return flight.price > budget;
}

/**
 * Keeps options that fit the per-person budget. When none fit, returns the full list
 * sorted cheapest-first so the browse screen can say the budget was relaxed.
 */
export function relevantOffers<T>(
  items: T[],
  exceeds: (item: T) => boolean,
  price: (item: T) => number,
): { items: T[]; relaxed: boolean } {
  const fitting = items.filter((item) => !exceeds(item));
  if (fitting.length > 0) return { items: fitting, relaxed: false };
  const priced = [...items].sort((a, b) => price(a) - price(b));
  return { items: priced, relaxed: items.length > 0 };
}

function budgetCurrency(currency: string | null | undefined): boolean {
  return !currency || currency === "USD";
}
