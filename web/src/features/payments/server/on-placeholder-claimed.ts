import "server-only";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { readError } from "./rpc-error";

/**
 * After a placeholder claims their lane (design §4.2): each of their `awaiting_member` share rows
 * becomes `pending`, with them as payer, so they can approve their own hold. The organizer keeps
 * fronting the share until then. One conditional update, so a repeated claim moves nothing.
 * Returns the mandates now waiting for their approval, for the member_joined card.
 */
export async function onPlaceholderClaimed(memberId: string): Promise<{ pendingMandateIds: string[] }> {
  const admin = getAdminClient();
  const { data: member, error } = await admin.from("trip_members").select("status").eq("id", memberId).maybeSingle();
  if (error) throw readError(error, "the member");
  if (member?.status !== "joined") throw new AppError("not_permitted", "Only a member who has joined can take over their share.");

  const { data: moved, error: moveError } = await admin
    .from("payment_holds")
    .update({ status: "pending", payer_member_id: memberId })
    .eq("share_member_id", memberId)
    .eq("kind", "own")
    .eq("status", "awaiting_member")
    .select("mandate_id");
  if (moveError) throw readError(moveError, "the holds");
  return { pendingMandateIds: [...new Set(moved.map((r) => r.mandate_id))] };
}
