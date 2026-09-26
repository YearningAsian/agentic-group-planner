import type { HoldKind } from "../enums";

/** A member's payment state for one share (design §2.1 summary card, §4.2, §5.5). */
export type ShareStatus = "paid" | "authorized" | "pending" | "awaiting_member" | "fronted" | "none";

/** The `payment_holds` columns a share's status depends on: its own row, plus a fronted row if any. */
export interface ShareRow {
  kind: HoldKind;
  status: string;
  share_cents: number;
  cap_cents: number;
}

export interface ShareStatusView {
  status: ShareStatus;
  /** What every surface shows, so the lanes, the itinerary, and the cards agree. */
  label: string;
  share_cents: number | null;
}

/** "$48", or "$48.50" when there are cents. Integer math only. */
function usd(cents: number): string {
  const rest = cents % 100;
  return `$${Math.trunc(cents / 100)}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}

/**
 * One share's status from its rows. The member's own captured row means Paid. Until then, a
 * fronted row the organizer's hold has authorized or captured reads "Fronted by the organizer".
 * Otherwise the own row decides: approved, waiting for approval (with the cap), waiting for the
 * placeholder to join, or no payment.
 */
export function shareStatus(rows: readonly ShareRow[]): ShareStatusView {
  const own = rows.find((r) => r.kind === "own");
  const fronted = rows.find((r) => r.kind === "fronted");
  if (!own) return { status: "none", label: "No payment", share_cents: null };
  const view = (status: ShareStatus, label: string): ShareStatusView => ({ status, label, share_cents: own.share_cents });

  if (own.status === "captured") return view("paid", "Paid");
  if (fronted && (fronted.status === "authorized" || fronted.status === "captured")) {
    return view("fronted", "Fronted by the organizer");
  }
  switch (own.status) {
    case "authorized":
      return view("authorized", `Approved, up to ${usd(own.cap_cents)}`);
    case "pending":
      return view("pending", `Approve up to ${usd(own.cap_cents)}`);
    case "awaiting_member":
      return view("awaiting_member", "Joins later");
    case "declined":
      return view("none", "Declined");
    default:
      return view("none", "No payment");
  }
}
