import "server-only";
import type { MandateStatus } from "@agp/shared";
import { getPaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { authorizeHold, finalizeIfWon, isSatisfied, type PaymentsDeps } from "./approve-hold";
import { mandateAndMember } from "./decline-hold";
import { readError, rpcError } from "./rpc-error";

const coverRows = (value: unknown) => (value as { rows: { id: string; share_member_id: string; status: string }[] }).rows;

/**
 * The organizer covers every share someone declined (design §4.2, plan CO-S02). `cover_shortfall`
 * adds a fronted row for each, and each is authorized on a cover hold of its own
 * (`pi-auth:{mandate_id}:{organizer}:cover:{share_member_id}`), since the organizer's main hold may
 * already be authorized and can't grow. Once every share is satisfied, the mandate moves
 * `partially_declined → authorized` and is finalized; until the others approve, it waits, and the
 * last approval finalizes it. Covering again, or concurrently, authorizes each cover once. A
 * declined card leaves the mandate partially declined, for the organizer to cancel.
 */
export async function coverShortfall(input: { mandateId: string; memberId: string }, deps: PaymentsDeps = {}): Promise<{ mandate_status: MandateStatus }> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();
  const { mandate, member } = await mandateAndMember(admin, input.mandateId, input.memberId);
  if (member.role !== "organizer") throw new AppError("not_permitted", "Only the organizer can cover a shortfall.");
  if (mandate.status === "partially_declined" && Date.parse(mandate.expires_at) < Date.now()) {
    throw new AppError("conflict", "The time to approve this purchase has run out.");
  }

  const { data, error } = await admin.rpc("cover_shortfall", {
    payload: { trip_id: mandate.trip_id, actor_member_id: member.id, mandate_id: mandate.id },
  });
  if (error) {
    // A cover that already went through leaves the mandate authorized or captured: report it.
    const covered = await admin.from("payment_holds").select("id").eq("mandate_id", mandate.id).like("idempotency_key", "cover:%").limit(1);
    const { data: current } = await admin.from("mandates").select("status").eq("id", mandate.id).single();
    if (covered.data?.length && current && (current.status === "authorized" || current.status === "captured")) {
      return { mandate_status: current.status as MandateStatus };
    }
    throw rpcError(error);
  }
  const rows = coverRows(data);
  if (rows.length === 0) throw new AppError("conflict", "There's no declined share left to cover.");

  for (const row of rows.filter((r) => r.status === "pending")) {
    await authorizeHold(admin, payments, mandate, member, "approving", { kind: "cover", shareMemberId: row.share_member_id });
  }

  const { data: after, error: afterError } = await admin.from("payment_holds").select("status").in("id", rows.map((r) => r.id));
  if (afterError) throw readError(afterError, "the holds");
  if (after.some((r) => r.status === "declined" || r.status === "failed")) {
    throw new AppError("domain_rule", "Your card was declined, so the shortfall isn't covered. Cancel the purchase instead.");
  }

  if (await isSatisfied(admin, mandate.id)) await finalizeIfWon(admin, mandate.id, deps);
  const { data: current, error: statusError } = await admin.from("mandates").select("status").eq("id", mandate.id).single();
  if (statusError) throw readError(statusError, "the purchase");
  return { mandate_status: current.status as MandateStatus };
}
