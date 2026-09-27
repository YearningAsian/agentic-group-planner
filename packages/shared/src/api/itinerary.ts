import { z } from "zod";
import { ItemStatus } from "../enums";

/** `GET /api/trips/:id/itinerary` query (design §2.4): whose schedule, as a calendar file. */
export const ItineraryQuery = z.object({
  format: z.literal("ics").default("ics"),
  /** `me` (the signed-in member) or another member's ID on the same trip. */
  member: z.union([z.literal("me"), z.uuid()]).default("me"),
});
export type ItineraryQuery = z.infer<typeof ItineraryQuery>;

export const ItineraryStop = z.object({
  item_id: z.uuid(),
  slot_key: z.string(),
  label: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: ItemStatus,
  /** The chosen place; null until the item is decided. */
  place: z.object({ place_id: z.uuid(), name: z.string(), address: z.string().nullable(), lat: z.number(), lng: z.number() }).nullable(),
  area_label: z.string().nullable(),
  /** Everyone else at this stop. */
  attendees: z.array(z.object({ member_id: z.uuid(), display_name: z.string() })),
  payment: z.object({
    status: z.enum(["paid", "authorized", "pending", "awaiting_member", "fronted", "none"]),
    label: z.string(),
    share_cents: z.number().int().min(0).nullable(),
  }),
});
export type ItineraryStop = z.infer<typeof ItineraryStop>;

/** One member's schedule (design §5.5): attended stops in time order, plus their money totals. */
export const ItineraryExport = z.object({
  trip: z.object({ id: z.uuid(), title: z.string(), city: z.string(), trip_date: z.string(), timezone: z.string() }),
  member: z.object({ member_id: z.uuid(), display_name: z.string() }),
  stops: z.array(ItineraryStop),
  totals: z.object({
    /** Shares approved, fronted, or paid. */
    committed_cents: z.number().int().min(0),
    paid_cents: z.number().int().min(0),
    /** Shares still waiting for this member's approval. */
    to_approve: z.number().int().min(0),
    status: z.enum(["none", "all_paid", "in_progress"]),
  }),
});
export type ItineraryExport = z.infer<typeof ItineraryExport>;
