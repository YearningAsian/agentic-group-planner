import "server-only";
import { holdFees } from "@agp/shared";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { readError } from "./rpc-error";

/** Long enough to capture and refund with retries; a crash only delays a retry this long. */
const SETTLE_LEASE_MS = 60_000;

/**
 * Settles a share the organizer fronted, once its member has paid (design §4.2, "After
 * capture"): captures the member's own authorized hold, then refunds the organizer
 * that fronted row's recorded part of the original capture (share plus its allocated fee) with key
 * `cover-refund:{mandate_id}:{share_member_id}`, and marks the fronted row `refunded`. The refund
 * happens only when the organizer's hold actually paid the share, and only after the member's
 * capture. A claim on the member's own row makes concurrent settlements run it once. Returns what
 * this call refunded (0 when there was nothing to settle).
 */
export async function settleFrontedShare(
  input: { mandateId: string; memberId: string },
  deps: { payments?: PaymentsProvider } = {},
): Promise<{ refundedCents: number }> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();
  const nothing = { refundedCents: 0 };

  const { data: mandate, error } = await admin.from("mandates").select("status").eq("id", input.mandateId).maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (mandate?.status !== "captured") return nothing;

  const { data: rows, error: rowsError } = await admin
    .from("payment_holds")
    .select("id, kind, status, share_cents, captured_cents, share_member_id, stripe_payment_intent_id")
    .eq("mandate_id", input.mandateId);
  if (rowsError) throw readError(rowsError, "the holds");
  const own = rows.find((r) => r.share_member_id === input.memberId && r.kind === "own");
  const fronted = rows.find((r) => r.share_member_id === input.memberId && r.kind === "fronted");
  if (!own || !fronted || fronted.status !== "captured") return nothing;
  if (own.status !== "authorized" && own.status !== "captured") return nothing;

  const now = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("payment_holds")
    .update({ lease_expires_at: new Date(now.getTime() + SETTLE_LEASE_MS).toISOString() })
    .eq("id", own.id)
    .in("status", ["authorized", "captured"])
    .or(`lease_expires_at.is.null,lease_expires_at.lt."${now.toISOString()}"`)
    .select("status");
  if (claimError) throw readError(claimError, "the holds");
  if (claimed.length === 0) return nothing;

  try {
    // Re-read under the claim: a settlement that just finished leaves nothing to do.
    const { data: current, error: currentError } = await admin
      .from("payment_holds")
      .select("id, status")
      .in("id", [own.id, fronted.id]);
    if (currentError) throw readError(currentError, "the holds");
    const status = new Map(current.map((r) => [r.id, r.status]));
    if (status.get(fronted.id) !== "captured") return nothing;

    if (status.get(own.id) === "authorized") {
      const amountCents = holdFees({ sharesCents: [own.share_cents], capPercent: 100 }).totalCents;
      // Marked first, so the payment_intent.succeeded webhook captures the row too, in any order.
      const marked = await admin.from("payment_holds").update({ pays_share: true }).eq("id", own.id).is("pays_share", null);
      if (marked.error) throw readError(marked.error, "the holds");
      await payments.capture({
        paymentIntentId: own.stripe_payment_intent_id!,
        amountCents,
        idempotencyKey: `pi-capture:${input.mandateId}:${input.memberId}`,
      });
      const captured = await admin
        .from("payment_holds")
        .update({ status: "captured", captured_cents: amountCents, captured_at: new Date().toISOString() })
        .eq("id", own.id)
        .in("status", ["authorized", "captured"]);
      if (captured.error) throw readError(captured.error, "the holds");
    }

    // The capture plan allocated the hold's one fixed fee across its paying rows. Using that
    // stored allocation makes each refund independent of other placeholders' settlement order.
    const refundedCents = fronted.captured_cents;
    if (typeof refundedCents !== "number" || !Number.isSafeInteger(refundedCents) || refundedCents <= 0) {
      throw new AppError("internal", "The fronted share has no recorded capture amount.");
    }
    await payments.refund({
      paymentIntentId: fronted.stripe_payment_intent_id!,
      amountCents: refundedCents,
      idempotencyKey: `cover-refund:${input.mandateId}:${input.memberId}`,
      metadata: { mandate_id: input.mandateId, share_member_id: input.memberId },
    });
    // Conditional: the charge.refunded webhook may already have moved it.
    const refunded = await admin
      .from("payment_holds")
      .update({ status: "refunded", refunded_cents: refundedCents })
      .eq("id", fronted.id)
      .eq("status", "captured");
    if (refunded.error) throw readError(refunded.error, "the holds");
    return { refundedCents };
  } finally {
    await admin.from("payment_holds").update({ lease_expires_at: null }).eq("id", own.id);
  }
}
