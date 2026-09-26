import "server-only";
import { MemberJoinedCard } from "@agp/shared";
import { onPlaceholderClaimed } from "@/features/payments/server";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Runs after a successful claim (design §5.3): the joiner's `awaiting_member` shares move to them
 * (`onPlaceholderClaimed`), and the trip gets one `member_joined` card listing the mandates now
 * waiting for their approval. Running it again moves nothing and writes no second card.
 */
export async function afterClaim(memberId: string): Promise<{ cardMessageId: string; pendingMandateIds: string[] }> {
  const admin = getAdminClient();
  const { data: member, error } = await admin
    .from("trip_members")
    .select("id, trip_id, display_name, lane_color, trips(seed_batch)")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read the member.", { retryable: true, cause: error });
  if (!member) throw new AppError("not_found", "That member doesn't exist.");

  const { pendingMandateIds } = await onPlaceholderClaimed(memberId);

  const { data: existing, error: existingError } = await admin
    .from("messages")
    .select("id")
    .eq("trip_id", member.trip_id)
    .eq("card_type", "member_joined")
    .eq("card_payload->>member_id", memberId)
    .limit(1);
  if (existingError) throw new AppError("internal", "Couldn't read the trip's messages.", { retryable: true, cause: existingError });
  if (existing[0]) return { cardMessageId: existing[0].id, pendingMandateIds };

  const card = MemberJoinedCard.parse({
    card_type: "member_joined",
    member_id: member.id,
    display_name: member.display_name,
    lane_color: member.lane_color,
    pending_mandate_ids: pendingMandateIds,
  });
  const trip = member.trips as { seed_batch: string | null } | null;
  const { data: inserted, error: insertError } = await admin
    .from("messages")
    .insert({ trip_id: member.trip_id, sender_type: "system", kind: "card", card_type: "member_joined", card_payload: card, seed_batch: trip?.seed_batch ?? null })
    .select("id")
    .single();
  if (insertError) throw new AppError("internal", "Couldn't post that the member joined.", { retryable: true, cause: insertError });
  return { cardMessageId: inserted.id, pendingMandateIds };
}
