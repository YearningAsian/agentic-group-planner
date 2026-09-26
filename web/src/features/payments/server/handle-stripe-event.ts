import "server-only";
import type { Database } from "@agp/shared/db";
import type { PaymentsEvent } from "@/lib/providers/payments";
import { finishWebhook, recordWebhook } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { holdFilter, holdForMetadata } from "../lib/hold";
import { readError } from "./rpc-error";

export type StripeEventOutcome = "processed" | "ignored" | "skipped";

/** What the ledger keeps: identifiers and statuses, never card data. */
function trimmed(event: PaymentsEvent) {
  return {
    payment_intent: event.paymentIntentId,
    status: event.status,
    metadata: event.metadata,
    decline_code: event.declineCode,
    refunds: event.refunds.map((r) => ({ id: r.id, amount_cents: r.amountCents, metadata: r.metadata })),
  };
}

/**
 * The payer's share rows an event is about. The PaymentIntent's metadata names them, which works
 * even before the synchronous path has saved the PaymentIntent ID on the rows. A payer can have a
 * main hold and cover holds on one mandate, so the rows are narrowed to the hold the event is for.
 */
function payerRows(admin: AdminClient, event: PaymentsEvent) {
  const { mandate_id: mandateId, payer_member_id: payerId } = event.metadata;
  const query = admin.from("payment_holds");
  return {
    update(fields: Database["public"]["Tables"]["payment_holds"]["Update"]) {
      const update = query.update(fields);
      if (mandateId && payerId) {
        return update
          .eq("mandate_id", mandateId)
          .eq("payer_member_id", payerId)
          .filter(...holdFilter(mandateId, holdForMetadata(event.metadata)));
      }
      return update.eq("stripe_payment_intent_id", event.paymentIntentId ?? "");
    },
  };
}

/** Applies one event with conditional updates only; returns false for a type this app ignores. */
async function apply(admin: AdminClient, event: PaymentsEvent): Promise<boolean> {
  if (!event.paymentIntentId) return false;
  const rows = payerRows(admin, event);
  let result;
  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
      // A row the finalizer already planned without (pays_share = false) stays for the approval
      // path to release, exactly as the synchronous update leaves it.
      result = await rows
        .update({ status: "authorized", stripe_payment_intent_id: event.paymentIntentId, authorized_at: new Date().toISOString() })
        .eq("status", "pending")
        .is("pays_share", null);
      break;
    case "payment_intent.payment_failed":
      // A decline ends as declined either way, so this path and the synchronous one agree.
      result = await rows
        .update({
          status: event.declineCode ? "declined" : "failed",
          decline_code: event.declineCode,
          stripe_payment_intent_id: event.paymentIntentId,
        })
        .eq("status", "pending");
      break;
    case "payment_intent.canceled":
      result = await rows.update({ status: "released" }).in("status", ["pending", "authorized"]);
      break;
    case "payment_intent.succeeded": {
      // finalizeMandate stored which rows pay before it captured, so both paths agree in any order.
      const captured = await rows
        .update({ status: "captured", captured_at: new Date().toISOString() })
        .eq("pays_share", true)
        .eq("status", "authorized");
      if (captured.error) throw readError(captured.error, "the holds");
      result = await rows.update({ status: "released" }).eq("pays_share", false).eq("status", "authorized");
      break;
    }
    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
      // Prefer refund.*; charge.refunded on API ≥ 2022-11-15 carries no refunds list.
      for (const refund of event.refunds) {
        const { mandate_id: mandateId, share_member_id: shareMemberId } = refund.metadata;
        if (!mandateId || !shareMemberId) continue;
        const refunded = await admin
          .from("payment_holds")
          .update({ status: "refunded", refunded_cents: refund.amountCents })
          .eq("mandate_id", mandateId)
          .eq("share_member_id", shareMemberId)
          .eq("kind", "fronted")
          .eq("status", "captured");
        if (refunded.error) throw readError(refunded.error, "the holds");
      }
      return true;
    default:
      return false;
  }
  if (result.error) throw readError(result.error, "the holds");
  return true;
}

/**
 * Handles one verified provider event (design §7.2): it's recorded first, so a duplicate or a
 * retry of a finished event changes nothing, then applied as conditional share-row updates only.
 * Events never book, capture, or refund, so this and the synchronous path end in the same state in
 * either order. A failure marks the event `failed` and rethrows, so the route answers 500 and the
 * provider retries.
 */
export async function handleStripeEvent(event: PaymentsEvent): Promise<StripeEventOutcome> {
  const decision = await recordWebhook({ provider: "stripe", eventId: event.id, type: event.type, payload: trimmed(event) });
  if (decision === "skip") return "skipped";
  try {
    const handled = await apply(getAdminClient(), event);
    await finishWebhook("stripe", event.id, handled ? "processed" : "ignored");
    return handled ? "processed" : "ignored";
  } catch (error) {
    await finishWebhook("stripe", event.id, "failed", error instanceof Error ? error.message : "The event failed.").catch(() => {});
    throw error;
  }
}
