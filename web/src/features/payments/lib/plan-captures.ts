import { holdFees } from "@agp/shared";

export interface ShareRow {
  id: string;
  shareMemberId: string;
  payerMemberId: string | null;
  kind: "own" | "fronted";
  status: string;
  shareCents: number;
  paymentIntentId: string | null;
}

export interface CapturePlan {
  /** The one row that pays each share. */
  paying: ShareRow[];
  /** PaymentIntent → amount to capture: `holdFees`' total for the rows it pays. */
  captureByIntent: Map<string, number>;
  /** Each paying row's part of its PaymentIntent's capture; they add up to the capture. */
  capturedCentsByRow: Map<string, number>;
  /** Authorized rows that don't pay: the other row for a share that's paid elsewhere. */
  release: ShareRow[];
  /** PaymentIntents with authorized rows but nothing to capture, so the whole hold is released. */
  releaseIntents: string[];
}

/** What a hold paying these shares charges. The total doesn't depend on the cap percent. */
const chargeFor = (sharesCents: number[]) => (sharesCents.length === 0 ? 0 : holdFees({ sharesCents, capPercent: 100 }).totalCents);

/**
 * Picks the one row that pays each share, and how much to capture on each PaymentIntent (design
 * §4.2). A share's own authorized row always wins over the organizer's fronted row. Each
 * PaymentIntent is captured once for everything it pays, so the fee is charged once per hold.
 */
export function planCaptures(rows: ShareRow[]): CapturePlan {
  const paying = new Map<string, ShareRow>(); // share_member_id → the row that pays it
  for (const row of rows) {
    if (row.status !== "authorized") continue;
    const current = paying.get(row.shareMemberId);
    if (!current || (row.kind === "own" && current.kind === "fronted")) paying.set(row.shareMemberId, row);
  }

  // Own rows first, so a fronted row's part is exactly the fee and share it added to the hold.
  const byIntent = new Map<string, ShareRow[]>();
  const ordered = [...paying.values()].sort(
    (a, b) => (a.kind === b.kind ? a.shareMemberId.localeCompare(b.shareMemberId) : a.kind === "own" ? -1 : 1),
  );
  for (const row of ordered) {
    if (!row.paymentIntentId) throw new Error(`share row ${row.id} is authorized without a PaymentIntent`);
    byIntent.set(row.paymentIntentId, [...(byIntent.get(row.paymentIntentId) ?? []), row]);
  }

  const captureByIntent = new Map<string, number>();
  const capturedCentsByRow = new Map<string, number>();
  for (const [intentId, intentRows] of byIntent) {
    const shares: number[] = [];
    for (const row of intentRows) {
      const before = chargeFor(shares);
      shares.push(row.shareCents);
      capturedCentsByRow.set(row.id, chargeFor(shares) - before);
    }
    captureByIntent.set(intentId, chargeFor(shares));
  }

  const release = rows.filter((r) => r.status === "authorized" && paying.get(r.shareMemberId) !== r);
  const releaseIntents = [...new Set(release.map((r) => r.paymentIntentId).filter((id): id is string => !!id && !byIntent.has(id)))];
  return { paying: [...paying.values()], captureByIntent, capturedCentsByRow, release, releaseIntents };
}
