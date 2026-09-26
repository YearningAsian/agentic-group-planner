import "server-only";
import type { MandateStatus } from "@agp/shared";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { mandateAndMember } from "./mandate-actor";
import { HOLD_COLUMNS, releaseCancelledHolds } from "./finalize-mandate";
import { readError } from "./rpc-error";

/**
 * The organizer cancels a purchase that's still collecting approvals (design §4.2): the mandate
 * moves `open` or `partially_declined → cancelled` with reason `organizer`, and every hold is
 * released. The status flips in one conditional update, so an approval racing the cancel either
 * finalizes first (and the cancel is refused) or finds its rows released and releases its own
 * PaymentIntent. Cancelling again finishes any release that failed and changes nothing else.
 */
export async function cancelByOrganizer(
  input: { mandateId: string; memberId: string },
  deps: { payments?: PaymentsProvider } = {},
): Promise<{ mandate_status: MandateStatus }> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();
  const { mandate, member } = await mandateAndMember(admin, input.mandateId, input.memberId);
  if (member.role !== "organizer") throw new AppError("not_permitted", "Only the organizer can cancel a purchase.");

  if (mandate.status !== "cancelled") {
    if (mandate.status !== "open" && mandate.status !== "partially_declined") {
      throw new AppError("conflict", "This purchase is already being booked, so it can't be cancelled here.");
    }
    const { data: cancelled, error } = await admin
      .from("mandates")
      .update({ status: "cancelled", cancel_reason: "organizer", lease_expires_at: null })
      .eq("id", mandate.id)
      .in("status", ["open", "partially_declined"])
      .select("id");
    if (error) throw readError(error, "the purchase");
    if (cancelled.length === 0) {
      const { data: current, error: currentError } = await admin.from("mandates").select("status").eq("id", mandate.id).single();
      if (currentError) throw readError(currentError, "the purchase");
      if (current.status !== "cancelled") throw new AppError("conflict", "This purchase is already being booked, so it can't be cancelled here.");
    }
  }

  const { data: rows, error: rowsError } = await admin.from("payment_holds").select(HOLD_COLUMNS).eq("mandate_id", mandate.id);
  if (rowsError) throw readError(rowsError, "the holds");
  await releaseCancelledHolds(admin, payments, mandate.id, rows);
  return { mandate_status: "cancelled" };
}
