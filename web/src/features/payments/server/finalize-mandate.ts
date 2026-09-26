import "server-only";
import { randomUUID } from "node:crypto";
import { BookingConfirmedCard, type MandateStatus } from "@agp/shared";
import { type BookResult, type BookingProvider, getBookingProvider } from "@/lib/providers/booking";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { quoteChangeReason } from "../lib/approved-quote";
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
  lease_expires_at: string | null;
};

const HOLD_COLUMNS = "id, share_member_id, payer_member_id, kind, status, share_cents, stripe_payment_intent_id, pays_share, lease_expires_at";
const PLAN_ATTEMPTS = 5;

const toShareRow = (r: HoldRow): ShareRow => ({
  id: r.id,
  shareMemberId: r.share_member_id,
  payerMemberId: r.payer_member_id,
  kind: r.kind as ShareRow["kind"],
  status: r.status,
  shareCents: r.share_cents,
  paymentIntentId: r.stripe_payment_intent_id,
});

interface StoredPlan {
  rows: HoldRow[];
  plan: CapturePlan;
  release: HoldRow[];
}

/** The plan already on the rows, from this finalizer or one that crashed after planning. */
function storedPlan(rows: HoldRow[]): StoredPlan {
  const paying = rows.filter((r) => r.pays_share === true).map((r) => ({ ...toShareRow(r), status: "authorized" }));
  const plan = planCaptures(paying);
  const release = rows.filter((r) => r.pays_share === false && r.status === "authorized");
  const releaseIntents = [...new Set(release.map((r) => r.stripe_payment_intent_id!).filter((id) => !plan.captureByIntent.has(id)))];
  return { rows, plan: { ...plan, releaseIntents }, release };
}

/**
 * Writes the capture plan onto the rows as `pays_share` before any provider call, so the webhook
 * path marks rows the same way and a retried finalizer repeats this plan. A placeholder's approval
 * still in flight (a pending row under its lease) is marked `false` first, conditional on it still
 * being pending, so exactly one side wins that row: either the approval lands first and the plan
 * is made again with its hold paying, or the plan lands first and the approval releases its hold.
 * Every mark is conditional on the status the plan saw; if anything moved, the marks are cleared
 * and the caller plans again. Returns null in that case.
 */
async function writePlan(admin: AdminClient, rows: HoldRow[]): Promise<StoredPlan | null> {
  const now = Date.now();
  const plan = planCaptures(rows.map(toShareRow));
  const inFlight = rows.filter((r) => r.status === "pending" && r.lease_expires_at !== null && Date.parse(r.lease_expires_at) > now);
  const marks: [HoldRow[], boolean, string][] = [
    [inFlight, false, "pending"],
    [rows.filter((r) => plan.paying.some((p) => p.id === r.id)), true, "authorized"],
    [rows.filter((r) => plan.release.some((p) => p.id === r.id)), false, "authorized"],
  ];
  const marked: string[] = [];
  for (const [targets, paysShare, status] of marks) {
    if (targets.length === 0) continue;
    const { data, error } = await admin
      .from("payment_holds")
      .update({ pays_share: paysShare })
      .in("id", targets.map((r) => r.id))
      .eq("status", status)
      .is("pays_share", null)
      .select("id");
    if (error) throw readError(error, "the holds");
    marked.push(...data.map((r) => r.id));
    if (data.length !== targets.length) {
      if (marked.length > 0) {
        const cleared = await admin.from("payment_holds").update({ pays_share: null }).in("id", marked);
        if (cleared.error) throw readError(cleared.error, "the holds");
      }
      return null;
    }
  }
  const releaseIds = new Set(plan.release.map((r) => r.id));
  return { rows, plan, release: rows.filter((r) => releaseIds.has(r.id)) };
}

/** Reads the rows and settles on one capture plan: the stored one, or a new one written first. */
async function capturePlan(admin: AdminClient, mandateId: string): Promise<StoredPlan> {
  for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt++) {
    const { data: rows, error } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandateId);
    if (error) throw readError(error, "the holds");
    // A plan is reused only when complete: a finalizer that crashed mid-write leaves some rows
    // unmarked, and before any capture its marks can simply be cleared.
    const complete = rows.some((r) => r.pays_share === true) && rows.every((r) => r.status !== "authorized" || r.pays_share !== null);
    if (complete || rows.some((r) => r.status === "captured")) return storedPlan(rows);
    if (rows.some((r) => r.pays_share !== null)) {
      const cleared = await admin.from("payment_holds").update({ pays_share: null }).eq("mandate_id", mandateId).not("pays_share", "is", null);
      if (cleared.error) throw readError(cleared.error, "the holds");
      continue;
    }
    const written = await writePlan(admin, rows);
    if (written) return written;
  }
  throw new AppError("internal", "The share rows kept changing while the purchase was being finalized.", { retryable: true });
}

const payerOf = (rows: HoldRow[], intentId: string) => rows.find((r) => r.stripe_payment_intent_id === intentId)?.payer_member_id;
type FinalizeCancelReason = "booking_failed" | "price_above_cap" | "price_changed";

function isFinalizeCancelReason(value: string | null): value is FinalizeCancelReason {
  return value === "booking_failed" || value === "price_above_cap" || value === "price_changed";
}

/** Idempotent cleanup after a cancellation decision, including a retry after provider release failed. */
async function releaseCancelledHolds(
  admin: AdminClient,
  payments: PaymentsProvider,
  mandateId: string,
  rows: HoldRow[],
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
}

/** Keep the mandate live until every old authorization is released, then finish cancellation. */
async function cancelMandate(
  admin: AdminClient,
  payments: PaymentsProvider,
  mandateId: string,
  rows: HoldRow[],
  reason: FinalizeCancelReason,
): Promise<void> {
  const decided = await admin
    .from("mandates")
    .update({ cancel_reason: reason })
    .eq("id", mandateId)
    .eq("status", "authorized")
    .select("id");
  if (decided.error) throw readError(decided.error, "the purchase");
  if (decided.data.length !== 1) throw new AppError("conflict", "The purchase changed while it was being cancelled.", { retryable: true });
  await releaseCancelledHolds(admin, payments, mandateId, rows);
  const cancelled = await admin
    .from("mandates")
    .update({ status: "cancelled", lease_expires_at: null })
    .eq("id", mandateId)
    .eq("status", "authorized")
    .eq("cancel_reason", reason)
    .select("id");
  if (cancelled.error) throw readError(cancelled.error, "the purchase");
  if (cancelled.data.length !== 1) throw new AppError("conflict", "The purchase changed while it was being cancelled.", { retryable: true });
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
    .select("id, trip_id, item_id, option_id, status, title, quote_cents, cap_cents, currency, cancel_reason, booking_quote_id, booking_provider_ref, booking_confirmation_code")
    .eq("id", mandateId)
    .maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (!mandate) throw new AppError("not_found", "That purchase doesn't exist.");
  if (mandate.status === "cancelled") {
    const { data: rows, error: rowsError } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandateId);
    if (rowsError) throw readError(rowsError, "the holds");
    await releaseCancelledHolds(admin, payments, mandateId, rows);
    return { status: "cancelled" };
  }
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
    if (mandate.cancel_reason) {
      if (!isFinalizeCancelReason(mandate.cancel_reason)) {
        throw new AppError("internal", "This purchase has an unsupported cancellation reason.");
      }
      const { data: rows, error: rowsError } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandateId);
      if (rowsError) throw readError(rowsError, "the holds");
      await cancelMandate(admin, payments, mandateId, rows, mandate.cancel_reason);
      return { status: "cancelled" };
    }
    const [itemResult, optionResult, organizerResult] = await Promise.all([
      admin.from("itinerary_items").select("starts_at").eq("id", mandate.item_id).single(),
      admin.from("item_options").select("place_id").eq("id", mandate.option_id).single(),
      admin.from("trip_members").select("id, display_name").eq("trip_id", mandate.trip_id).eq("role", "organizer").single(),
    ]);
    for (const result of [itemResult, optionResult, organizerResult]) {
      if (result.error) throw readError(result.error, "the purchase");
    }
    const organizer = organizerResult.data!;
    const { rows, plan, release } = await capturePlan(admin, mandateId);

    const partySize = new Set(rows.map((r) => r.share_member_id)).size;
    const startsAt = itemResult.data!.starts_at;
    let quoteId = mandate.booking_quote_id;
    if (!quoteId) {
      // The first attempt needs a fresh quote. A retry after booking may have captured only some
      // intents, so it must use the quote saved before that booking instead of re-pricing it.
      const quote = await booking.quote({ kind: "tickets", placeId: optionResult.data!.place_id, optionId: mandate.option_id, partySize, startsAt });
      const changed = quoteChangeReason({
        approvedCents: mandate.quote_cents,
        capCents: mandate.cap_cents,
        currency: mandate.currency,
        currentCents: quote.totalCents,
        currentCurrency: quote.currency,
      });
      if (changed) {
        await cancelMandate(admin, payments, mandateId, rows, changed);
        return { status: "cancelled" };
      }
      const saved = await admin.from("mandates")
        .update({ booking_quote_id: quote.quoteId })
        .eq("id", mandateId)
        .eq("status", "authorized")
        .is("booking_quote_id", null)
        .select("id");
      if (saved.error) throw readError(saved.error, "the booking quote");
      if (saved.data.length !== 1) throw new AppError("conflict", "The purchase changed while booking began.", { retryable: true });
      quoteId = quote.quoteId;
    }
    let booked: BookResult;
    if (mandate.booking_provider_ref) {
      booked = {
        status: "confirmed",
        providerRef: mandate.booking_provider_ref,
        confirmationCode: mandate.booking_confirmation_code ?? undefined,
      };
    } else {
      booked = await booking.book({
        kind: "tickets",
        quoteId,
        partySize,
        startsAt,
        contactName: organizer.display_name,
        idempotencyKey: `booking:${mandateId}`,
      });
      if (booked.status !== "confirmed") {
        await cancelMandate(admin, payments, mandateId, rows, "booking_failed");
        return { status: "cancelled" };
      }
      if (!booked.providerRef) throw new AppError("provider_unavailable", "The merchant confirmed without a booking reference.");
      const saved = await admin.from("mandates")
        .update({ booking_provider_ref: booked.providerRef, booking_confirmation_code: booked.confirmationCode ?? null })
        .eq("id", mandateId)
        .eq("status", "authorized")
        .is("booking_provider_ref", null)
        .select("id");
      if (saved.error) throw readError(saved.error, "the booking");
      if (saved.data.length !== 1) throw new AppError("conflict", "The purchase changed while booking was confirmed.", { retryable: true });
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
      total_cents: mandate.quote_cents,
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
          total_cents: mandate.quote_cents,
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
