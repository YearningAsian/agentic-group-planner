import "server-only";
import type { Database } from "@agp/shared/db";
import type { PaymentsEvent } from "@/lib/providers/payments";
import { finishWebhook, recordWebhook } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
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
 * even before the synchronous path has saved the PaymentIntent ID on the rows.
 */
function payerRows(admin: AdminClient, event: PaymentsEvent) {
  const { mandate_id: mandateId, payer_member_id: payerId } = event.metadata;
  const query = admin.from("payment_holds");
  return {
    update(fields: Database["public"]["Tables"]["payment_holds"]["Update"]) {
      const update = query.update(fields);
      if (mandateId && payerId) return update.eq("mandate_id", mandateId).eq("payer_member_id", payerId);
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
      result = await rows
        .update({ status: "authorized", stripe_payment_intent_id: event.paymentIntentId, authorized_at: new Date().toISOString() })
        .eq("status", "pending");
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
