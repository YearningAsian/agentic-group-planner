import { z } from "zod";

/** A placeholder's invite token: nanoid(21), URL-safe (design §3.2 trip_members). */
export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{21}$/, "not an invite token");
export type InviteToken = z.infer<typeof InviteToken>;

/** `POST /api/invites/claim` (signed in): claims the placeholder's lane for the caller. */
export const ClaimInviteRequest = z.object({ token: InviteToken });
export type ClaimInviteRequest = z.infer<typeof ClaimInviteRequest>;

export const ClaimInviteResponse = z.object({
  trip_slug: z.string().length(11),
  /** The claimed trip_members row, now joined with the caller's profile. */
  member_id: z.uuid(),
});
export type ClaimInviteResponse = z.infer<typeof ClaimInviteResponse>;

/** One stop in the invited member's planned lane, in the trip's local time. */
export const InviteStop = z.object({
  label: z.string(),
  /** "HH:MM" in the trip's timezone, so the page needs no timezone of its own. */
  starts: z.string().regex(/^\d{2}:\d{2}$/),
  ends: z.string().regex(/^\d{2}:\d{2}$/),
  /** The chosen or top-ranked place; null while the slot is still TBD. */
  place_name: z.string().nullable(),
});
export type InviteStop = z.infer<typeof InviteStop>;

/**
 * What `/join/[token]` shows before anyone signs in (design §5.3). An open invite reveals only
 * the trip's title and date and the invited member's own lane: no other members, prices, or IDs.
 */
export const InvitePreview = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("open"),
    trip: z.object({ title: z.string(), trip_date: z.iso.date() }),
    lane: z.object({ display_name: z.string(), lane_color: z.string(), stops: z.array(InviteStop) }),
  }),
  /** The token was claimed; the page reads "This invite was already used." */
  z.object({ status: z.literal("used") }),
  /** No such token; the page reads "Invite not found." */
  z.object({ status: z.literal("not_found") }),
]);
export type InvitePreview = z.infer<typeof InvitePreview>;
