import "server-only";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { getAdminClient } from "@/lib/supabase/admin";
import { HOLD_COLUMNS, releaseCancelledHolds } from "./finalize-mandate";
import { readError } from "./rpc-error";

const OPEN = ["open", "partially_declined"];
const LIVE_HOLDS = ["awaiting_member", "pending", "authorized"];

/**
 * Cancels every open mandate past `expires_at` with reason `expired` and releases its holds
 * (design §4.2). The status flips in one conditional update, so an approval racing the expiry
 * either wins open → authorized first or finds the mandate cancelled. An authorization still in
 * flight sees its rows released and releases its own PaymentIntent. Expired mandates whose release
 * failed earlier are retried, so running this twice changes nothing more. One mandate's failed
 * release is reported in `failed` and doesn't stop the others.
 */
export async function expireMandates(
  deps: { payments?: PaymentsProvider; now?: Date } = {},
): Promise<{ expired: string[]; failed: string[] }> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();
  const now = (deps.now ?? new Date()).toISOString();

  const { data: cancelled, error } = await admin
    .from("mandates")
    .update({ status: "cancelled", cancel_reason: "expired", lease_expires_at: null })
    .in("status", OPEN)
    .lt("expires_at", now)
    .select("id");
  if (error) throw readError(error, "the purchases");

  const { data: unreleased, error: leftoverError } = await admin
    .from("payment_holds")
    .select("mandate_id, mandates!inner(status, cancel_reason)")
    .in("status", LIVE_HOLDS)
    .eq("mandates.status", "cancelled")
    .eq("mandates.cancel_reason", "expired");
  if (leftoverError) throw readError(leftoverError, "the holds");

  const mandateIds = [...new Set([...cancelled.map((m) => m.id), ...unreleased.map((r) => r.mandate_id)])];
  const failed: string[] = [];
  for (const mandateId of mandateIds) {
    try {
      const { data: rows, error: rowsError } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandateId);
      if (rowsError) throw readError(rowsError, "the holds");
      await releaseCancelledHolds(admin, payments, mandateId, rows);
    } catch {
      // Its rows stay live, so the next run finds it through `unreleased` and retries.
      failed.push(mandateId);
    }
  }
  return { expired: cancelled.map((m) => m.id), failed };
}
