import "server-only";
import { randomUUID } from "node:crypto";
import { BookingConfirmedCard, type MandateStatus } from "@agp/shared";
import { type BookingProvider, getBookingProvider } from "@/lib/providers/booking";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { type CapturePlan, planCaptures, type ShareRow } from "../lib/plan-captures";
import { readError, rpcError } from "./rpc-error";

/** Long enough to book and capture every hold with retries; a crash only delays a retry this long. */
const FINALIZE_LEASE_MS = 120_000;

export interface FinalizeDeps {
  payments?: PaymentsProvider;
  /** The merchant; tests pass one whose book() fails. */
  booking?: BookingProvider;
}

type HoldRow = {
  id: string;
  share_member_id: string;
  payer_member_id: string | null;
  kind: string;
  status: string;
  share_cents: number;
  stripe_payment_intent_id: string | null;
  pays_share: boolean | null;
};

const toShareRow = (r: HoldRow): ShareRow => ({
  id: r.id,
  shareMemberId: r.share_member_id,
  payerMemberId: r.payer_member_id,
  kind: r.kind as ShareRow["kind"],
  status: r.status,
  shareCents: r.share_cents,
  paymentIntentId: r.stripe_payment_intent_id,
});

/**
 * The capture plan, stored on the rows as `pays_share` before any provider call, so the webhook
 * path marks rows the same way, and a retried finalizer repeats the first plan instead of making
 * a new one from rows that have moved since.
 */
async function capturePlan(admin: AdminClient, rows: HoldRow[]): Promise<{ plan: CapturePlan; release: HoldRow[] }> {
  if (rows.some((r) => r.pays_share !== null)) {
    const paying = rows.filter((r) => r.pays_share === true).map((r) => ({ ...toShareRow(r), status: "authorized" }));
    const plan = planCaptures(paying);
    const release = rows.filter((r) => r.pays_share === false && r.status === "authorized");
    const releaseIntents = [...new Set(release.map((r) => r.stripe_payment_intent_id!).filter((id) => !plan.captureByIntent.has(id)))];
    return { plan: { ...plan, releaseIntents }, release };
  }
  const plan = planCaptures(rows.map(toShareRow));
  const flag = async (ids: string[], paysShare: boolean) => {
    if (ids.length === 0) return;
    const { error } = await admin.from("payment_holds").update({ pays_share: paysShare }).in("id", ids).is("pays_share", null);
    if (error) throw readError(error, "the holds");
  };
  await flag(plan.paying.map((r) => r.id), true);
  await flag(plan.release.map((r) => r.id), false);
  const releaseIds = new Set(plan.release.map((r) => r.id));
  return { plan, release: rows.filter((r) => releaseIds.has(r.id)) };
}

const payerOf = (rows: HoldRow[], intentId: string) => rows.find((r) => r.stripe_payment_intent_id === intentId)?.payer_member_id;

/** Releases every hold and cancels the mandate, when the booking can't go ahead. */
async function cancelMandate(
  admin: AdminClient,
  payments: PaymentsProvider,
  mandateId: string,
  rows: HoldRow[],
  reason: "booking_failed" | "price_above_cap",
): Promise<void> {
  const intents = [...new Set(rows.filter((r) => r.status === "authorized").map((r) => r.stripe_payment_intent_id!))];
  for (const intentId of intents) {
    await payments.release({ paymentIntentId: intentId, idempotencyKey: `pi-release:${mandateId}:${payerOf(rows, intentId)}` });
  }
  const released = await admin
    .from("payment_holds")
    .update({ status: "released", lease_expires_at: null })
    .eq("mandate_id", mandateId)
    .in("status", ["awaiting_member", "pending", "authorized"]);
  if (released.error) throw readError(released.error, "the holds");
  const cancelled = await admin
    .from("mandates")
    .update({ status: "cancelled", cancel_reason: reason, lease_expires_at: null })
    .eq("id", mandateId)
    .eq("status", "authorized");
  if (cancelled.error) throw readError(cancelled.error, "the purchase");
}

/**
 * Books and pays for an authorized mandate (design §4.2): exactly one finalizer claims it, stores
 * which row pays each share (a share's own authorized hold wins over the organizer's fronted
 * row), re-quotes and books with key `booking:{mandate_id}`, captures each PaymentIntent once for
 * `holdFees`' total of the rows it pays (`pi-capture:{mandate_id}:{payer}`), and records it all
 * with `complete_mandate`. A failed booking releases every hold and cancels the mandate
 * (`booking_failed`). Returns the mandate's status; a mandate that isn't authorized, or that
 * another finalizer holds, is left as it is.
 */
export async function finalizeMandate(mandateId: string, deps: FinalizeDeps = {}): Promise<{ status: MandateStatus }> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();
  const booking = deps.booking ?? getBookingProvider("tickets");

  const { data: mandate, error } = await admin
    .from("mandates")
    .select("id, trip_id, item_id, option_id, status, title, cap_cents, currency")
    .eq("id", mandateId)
    .maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (!mandate) throw new AppError("not_found", "That purchase doesn't exist.");
  if (mandate.status !== "authorized") return { status: mandate.status as MandateStatus };

  const now = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("mandates")
    .update({ lease_expires_at: new Date(now.getTime() + FINALIZE_LEASE_MS).toISOString() })
    .eq("id", mandateId)
    .eq("status", "authorized")
    .or(`lease_expires_at.is.null,lease_expires_at.lt."${now.toISOString()}"`)
    .select("id");
  if (claimError) throw readError(claimError, "the purchase");
  if (claimed.length === 0) return { status: "authorized" };

  try {
    const [holdResult, itemResult, optionResult, organizerResult] = await Promise.all([
      admin
        .from("payment_holds")
        .select("id, share_member_id, payer_member_id, kind, status, share_cents, stripe_payment_intent_id, pays_share")
        .eq("mandate_id", mandateId),
      admin.from("itinerary_items").select("starts_at").eq("id", mandate.item_id).single(),
      admin.from("item_options").select("place_id").eq("id", mandate.option_id).single(),
      admin.from("trip_members").select("id, display_name").eq("trip_id", mandate.trip_id).eq("role", "organizer").single(),
    ]);
    for (const result of [holdResult, itemResult, optionResult, organizerResult]) {
      if (result.error) throw readError(result.error, "the purchase");
    }
    const rows = holdResult.data!;
    const organizer = organizerResult.data!;
    const { plan, release } = await capturePlan(admin, rows);

    const partySize = new Set(rows.map((r) => r.share_member_id)).size;
    const startsAt = itemResult.data!.starts_at;
    // The mandate's quote expired long ago; book() works from a fresh one.
    const quote = await booking.quote({ kind: "tickets", placeId: optionResult.data!.place_id, optionId: mandate.option_id, partySize, startsAt });
    if (quote.totalCents > mandate.cap_cents) {
      await cancelMandate(admin, payments, mandateId, rows, "price_above_cap");
      return { status: "cancelled" };
    }
    const booked = await booking.book({
      kind: "tickets",
      quoteId: quote.quoteId,
      partySize,
      startsAt,
      contactName: organizer.display_name,
      idempotencyKey: `booking:${mandateId}`,
    });
    if (booked.status !== "confirmed") {
      await cancelMandate(admin, payments, mandateId, rows, "booking_failed");
      return { status: "cancelled" };
    }

    for (const [intentId, amountCents] of plan.captureByIntent) {
      await payments.capture({ paymentIntentId: intentId, amountCents, idempotencyKey: `pi-capture:${mandateId}:${payerOf(rows, intentId)}` });
    }
    for (const intentId of plan.releaseIntents) {
      await payments.release({ paymentIntentId: intentId, idempotencyKey: `pi-release:${mandateId}:${payerOf(rows, intentId)}` });
    }

    const bookingId = randomUUID();
    const card = BookingConfirmedCard.parse({
      card_type: "booking_confirmed",
      booking_id: bookingId,
      item_id: mandate.item_id,
      provider: "mock_merchant",
      title: mandate.title,
      starts_at: startsAt,
      party_size: partySize,
      total_cents: quote.totalCents,
      payer: "split",
      confirmation_code: booked.confirmationCode ?? null,
    });
    const { error: rpcFailure } = await admin.rpc("complete_mandate", {
      payload: {
        trip_id: mandate.trip_id,
        actor_member_id: organizer.id,
        mandate_id: mandateId,
        booking: {
          id: bookingId,
          provider: "mock_merchant",
          provider_ref: booked.providerRef,
          confirmation_code: booked.confirmationCode ?? null,
          total_cents: quote.totalCents,
          currency: mandate.currency,
          details: { party_size: partySize, starts_at: startsAt, name: mandate.title, notes: null },
        },
        captures: plan.paying.map((r) => ({ row_id: r.id, captured_cents: plan.capturedCentsByRow.get(r.id)! })),
        releases: release.map((r) => r.id),
        card,
      },
    });
    if (rpcFailure) throw rpcError(rpcFailure);
    return { status: "captured" };
  } catch (failure) {
    // Let a retry take over at once instead of waiting out the lease.
    await admin.from("mandates").update({ lease_expires_at: null }).eq("id", mandateId).eq("status", "authorized");
    throw failure;
  }
}
