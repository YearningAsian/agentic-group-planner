/**
 * Client-only formatting helpers (prototype port). `money` formats whole dollars for the
 * draft UI; real charges use integer cents computed on the server.
 * `nightsBetween` returns 3 when either date is missing. `isLiveMapboxToken` lives in
 * `lib/mapbox/token` (providers may not import features) and is re-exported here for UI code.
 */

import { destinationById } from "@/features/trip-draft/fixtures";

export { isLiveMapboxToken } from "@/lib/mapbox/token";

/** Set by the questionnaire handoff; the studio consumes it once. */
export const QUESTIONNAIRE_KICKOFF_KEY = "planner-questionnaire-kickoff";

export type QuestionnaireBriefInput = {
  destinationId: string | null;
  destinationLabel?: string;
  destinationIata?: string | null;
  originLabel?: string;
  startDate: string;
  endDate: string;
  roundTrip?: boolean;
  placesToVisit?: string;
  stayPreference?: string;
  budget: number | null;
  dietary: string[];
  vibes: string[];
  members: Array<{ name: string; placeholder: boolean }>;
};


/** Converts whole dollars to integer cents for the future server handoff. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function money(dollars: number): string {
  return formatMoney(dollars, "USD");
}

export function formatMoney(amount: number, currency: string, maximumFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(maximumFractionDigits)} ${currency}`;
  }
}

export function nightsBetween(start: string, end: string): number {
  if (!start || !end) return 3;
  const ms = Date.parse(`${end}T12:00:00`) - Date.parse(`${start}T12:00:00`);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.round(ms / 86_400_000);
}

export function stayOverBudget(nightly: number, nights: number, budgetPerPerson: number | null): boolean {
  if (budgetPerPerson == null) return false;
  return nightly * Math.max(nights, 1) > budgetPerPerson;
}

export function formatDay(iso: string): string {
  if (!iso) return "Dates flexible";
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function formatRange(start: string, end: string): string {
  if (!start || !end) return "Dates flexible";
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" });
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${month.format(a)} ${a.getDate()}–${b.getDate()}`;
  }
  return `${month.format(a)} ${a.getDate()} – ${month.format(b)} ${b.getDate()}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function validRange(start: string, end: string): boolean {
  if (!start || !end) return false;
  return Date.parse(`${end}T12:00:00`) > Date.parse(`${start}T12:00:00`);
}

/** One paragraph the studio sends so the agent starts from every questionnaire answer. */
export function questionnaireBrief(state: QuestionnaireBriefInput): string {
  const fixture = destinationById(state.destinationId);
  const label = state.destinationLabel?.trim() || fixture?.label || "the destination";
  const origin = state.originLabel?.trim();
  const where = origin ? `from ${origin} to ${label}` : `to ${label}`;
  const roundTrip = state.roundTrip !== false;
  const when = roundTrip
    ? `${formatRange(state.startDate, state.endDate)}, round trip`
    : `${formatDay(state.startDate)}, one way`;
  const budget =
    state.budget != null && state.budget > 0 ? `Budget is ${money(state.budget)} per person.` : "Budget is open.";
  const parts = [`Plan a trip ${where}, ${when}. Recommend the airports.`, budget];
  const visit = state.placesToVisit?.trim();
  if (visit) parts.push(`They want to visit: ${visit}. Recommend places that match.`);
  const stay = state.stayPreference?.trim();
  if (stay) parts.push(`Stay: ${stay}.`);
  return parts.join(" ");
}

