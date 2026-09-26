/**
 * Client-only formatting helpers (prototype port). `money` formats whole dollars for the
 * draft UI; real charges use integer cents computed on the server.
 * `nightsBetween` returns 3 when either date is missing. `isLiveMapboxToken` is what `trip-map.tsx` uses to pick Mapbox.
 */

/** Converts whole dollars to integer cents for the future server handoff. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function money(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
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

export function isLiveMapboxToken(token: string | undefined): token is string {
  if (!token) return false;
  if (!token.startsWith("pk.")) return false;
  if (token.includes("placeholder") || token.includes("dummy")) return false;
  return token.length > 40;
}
