import "server-only";
import { createHash } from "node:crypto";
import { invites } from "@agp/shared";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";

function readError(cause: unknown): AppError {
  return new AppError("internal", "Couldn't open the invite. Try again.", { retryable: true, cause });
}

/** "HH:MM" in the trip's timezone, so the page shows the trip's clock wherever the phone is. */
function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** The same digest claim_invite stores, so a spent token can be recognized without keeping it. */
function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * What an invite link shows before anyone signs in (design §5.3): the trip's title and date and
 * the invited member's planned lane, or that the link was used or doesn't exist. The visitor isn't
 * a member yet, so row-level security would hide everything; this reads with the admin client and
 * returns only those fields.
 *
 * A lane holds the items the member attends plus the TBD blocks nobody is assigned to yet, which
 * are everyone's; replaced and cancelled items never show.
 */
export async function previewInvite(token: string, admin: AdminClient = getAdminClient()): Promise<invites.InvitePreview> {
  if (!invites.InviteToken.safeParse(token).success) return { status: "not_found" };

  const { data: member, error } = await admin
    .from("trip_members")
    .select("id, trip_id, display_name, lane_color, trips(title, trip_date, timezone)")
    .eq("invite_token", token)
    .in("status", ["placeholder", "invited"])
    .maybeSingle();
  if (error) throw readError(error);

  if (!member?.trips) {
    const { data: used, error: usedError } = await admin
      .from("trip_members")
      .select("id")
      .eq("claimed_token_hash", tokenHash(token))
      .limit(1);
    if (usedError) throw readError(usedError);
    return used.length > 0 ? { status: "used" } : { status: "not_found" };
  }

  const { data: items, error: itemsError } = await admin
    .from("itinerary_items")
    .select(
      "label, starts_at, ends_at, chosen_option_id, item_attendees(member_id), item_options!item_options_item_id_fkey(id, rank, places(name))",
    )
    .eq("trip_id", member.trip_id)
    .not("status", "in", "(superseded,cancelled)")
    .order("starts_at")
    .order("position");
  if (itemsError) throw readError(itemsError);

  const trip = member.trips;
  const stops = items
    .filter((item) => item.item_attendees.length === 0 || item.item_attendees.some((a) => a.member_id === member.id))
    .map((item) => {
      // A decided item shows its chosen option; before that, the plan's top-ranked one.
      const ranked = [...item.item_options].sort((a, b) => a.rank - b.rank);
      const option = ranked.find((o) => o.id === item.chosen_option_id) ?? ranked[0];
      return {
        label: item.label,
        starts: localTime(item.starts_at, trip.timezone),
        ends: localTime(item.ends_at, trip.timezone),
        place_name: option?.places?.name ?? null,
      };
    });

  return {
    status: "open",
    trip: { title: trip.title, trip_date: trip.trip_date },
    lane: { display_name: member.display_name, lane_color: member.lane_color, stops },
  };
}
