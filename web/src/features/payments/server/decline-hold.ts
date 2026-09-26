import "server-only";
import type { HoldStatus, MandateStatus } from "@agp/shared";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { mandateAndMember, notCollecting } from "./mandate-actor";
import { readError } from "./rpc-error";

/** Rows that can still pay a share: a placeholder's, a pending or authorized one, or one already paid. */
const LIVE = ["awaiting_member", "pending", "authorized", "captured"];

async function mandateStatus(admin: AdminClient, mandateId: string): Promise<MandateStatus> {
  const { data, error } = await admin.from("mandates").select("status").eq("id", mandateId).single();
  if (error) throw readError(error, "the purchase");
  return data.status as MandateStatus;
}

/**
 * Moves the mandate `open → partially_declined` if nothing can pay this member's share any more.
 * Conditional, so running it again, or after the payment_failed webhook declined the row, is safe.
 */
async function markShortfall(admin: AdminClient, mandateId: string, memberId: string): Promise<void> {
  const { data: live, error } = await admin
    .from("payment_holds")
    .select("id")
    .eq("mandate_id", mandateId)
    .eq("share_member_id", memberId)
    .in("status", LIVE);
  if (error) throw readError(error, "the holds");
  if (live.length > 0) return;
  const moved = await admin.from("mandates").update({ status: "partially_declined" }).eq("id", mandateId).eq("status", "open");
  if (moved.error) throw readError(moved.error, "the purchase");
}

/**
 * A member declines their share of a purchase (design §4.2). Their pending own row moves to
 * `declined`. The mandate moves `open → partially_declined` only when nothing else can pay that
 * share: a placeholder who joins and declines is still covered by the organizer's fronted row. The
 * organizer covers or cancels instead of declining. Declining twice changes nothing more; a member
 * who already approved can't decline, since their card is held.
 */
export async function declineHold(input: { mandateId: string; memberId: string }): Promise<{ hold_status: HoldStatus; mandate_status: MandateStatus }> {
  const admin = getAdminClient();
  const { mandate, member } = await mandateAndMember(admin, input.mandateId, input.memberId);
  if (member.role === "organizer") {
    throw new AppError("domain_rule", "As the organizer, cancel the purchase instead of declining it.");
  }

  const { data: own, error } = await admin
    .from("payment_holds")
    .select("id, status")
    .eq("mandate_id", mandate.id)
    .eq("share_member_id", member.id)
    .eq("kind", "own")
    .maybeSingle();
  if (error) throw readError(error, "the holds");
  if (!own) throw new AppError("not_permitted", "You don't have a share of this purchase.");
  if (own.status === "declined") {
    // A retry, or a row the webhook declined: finish moving the mandate if that step never ran.
    await markShortfall(admin, mandate.id, member.id);
    return { hold_status: "declined", mandate_status: await mandateStatus(admin, mandate.id) };
  }
  if (mandate.status === "cancelled" || mandate.status === "failed") throw notCollecting(mandate);
  if (own.status === "authorized" || own.status === "captured") {
    throw new AppError("conflict", "You've already approved this purchase. Ask the organizer if it needs cancelling.");
  }
  if (own.status !== "pending") throw new AppError("conflict", "This purchase isn't waiting for your approval.");

  // Not while this member's approval holds the row's lease: that authorization would be orphaned.
  const now = new Date().toISOString();
  const { data: declined, error: declineError } = await admin
    .from("payment_holds")
    .update({ status: "declined", lease_expires_at: null })
    .eq("id", own.id)
    .eq("status", "pending")
    .or(`lease_expires_at.is.null,lease_expires_at.lt."${now}"`)
    .select("id");
  if (declineError) throw readError(declineError, "the holds");
  if (declined.length === 0) {
    const { data: current, error: currentError } = await admin.from("payment_holds").select("status").eq("id", own.id).single();
    if (currentError) throw readError(currentError, "the holds");
    if (current.status !== "declined") throw new AppError("conflict", "Your approval is still in progress. Try again in a moment.", { retryable: true });
  }
  await markShortfall(admin, mandate.id, member.id);
  return { hold_status: "declined", mandate_status: await mandateStatus(admin, mandate.id) };
}
