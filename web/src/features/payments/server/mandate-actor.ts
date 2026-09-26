import "server-only";
import { AppError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import { readError } from "./rpc-error";

/** The mandate and the joined member acting on it, or `not_found` / `not_permitted`. Shared by decline, cover, and cancel. */
export async function mandateAndMember(admin: AdminClient, mandateId: string, memberId: string) {
  const { data: mandate, error } = await admin
    .from("mandates")
    .select("id, trip_id, status, currency, expires_at, cancel_reason")
    .eq("id", mandateId)
    .maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (!mandate) throw new AppError("not_found", "That purchase doesn't exist.");
  const { data: member, error: memberError } = await admin
    .from("trip_members")
    .select("id, profile_id, display_name, role, status")
    .eq("id", memberId)
    .eq("trip_id", mandate.trip_id)
    .maybeSingle();
  if (memberError) throw readError(memberError, "the trip's members");
  if (!member || member.status !== "joined") throw new AppError("not_permitted", "Only members of this trip can act on its purchases.");
  return { mandate, member };
}

/** The error an action on a purchase that's no longer collecting approvals gets, same as approveHold's. */
export function notCollecting(mandate: { cancel_reason: string | null }): AppError {
  return new AppError(
    "conflict",
    mandate.cancel_reason === "expired" ? "The time to approve this purchase has run out." : "This purchase isn't waiting for approvals any more.",
  );
}
