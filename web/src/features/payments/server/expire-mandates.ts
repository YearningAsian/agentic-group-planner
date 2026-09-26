import "server-only";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { HOLD_COLUMNS, releaseCancelledHolds } from "./finalize-mandate";
import { readError } from "./rpc-error";

const OPEN = ["open", "partially_declined"];
const LIVE_HOLDS = ["awaiting_member", "pending", "authorized"];

/**
 * Cancels every open mandate past `expires_at` with reason `expired` and releases its holds
 * (design §4.2). The status flips in one conditional update, so an approval racing the expiry
 * either wins open → authorized first or finds the mandate cancelled. An authorization still in
 * flight sees its rows released and releases its own PaymentIntent. Any cancelled mandate whose
 * release failed earlier (expired or cancelled by the organizer) is retried, so running this twice
 * changes nothing more. One mandate's failed
 * release is logged, reported in `failed`, and doesn't stop the others; a provider outage stops the
 * run instead of waiting out a timeout per mandate. Either way the rows stay live, so the next run
 * finds them again.
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
    .select("mandate_id, mandates!inner(status)")
    .in("status", LIVE_HOLDS)
    // Any cancel, not only expiry: an organizer's cancel whose release failed is swept up here too.
    .eq("mandates.status", "cancelled");
  if (leftoverError) throw readError(leftoverError, "the holds");

  // In id order, so a run is repeatable and its log reads the same way twice.
  const mandateIds = [...new Set([...cancelled.map((m) => m.id), ...unreleased.map((r) => r.mandate_id)])].sort();
  const failed: string[] = [];
  for (const [index, mandateId] of mandateIds.entries()) {
    try {
      const { data: rows, error: rowsError } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandateId);
      if (rowsError) throw readError(rowsError, "the holds");
      await releaseCancelledHolds(admin, payments, mandateId, rows);
    } catch (error) {
      console.error(`expire-mandates: releasing the holds of ${mandateId} failed`, error);
      failed.push(mandateId);
      if (error instanceof AppError && (error.code === "provider_unavailable" || error.code === "timeout")) {
        failed.push(...mandateIds.slice(index + 1));
        break;
      }
    }
  }
  return { expired: cancelled.map((m) => m.id), failed };
}
