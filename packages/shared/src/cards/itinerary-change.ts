import { z } from "zod";
import { UpdateItemAction } from "../tools/update-item";

export const ItineraryChange = z.object({
  /** The item as it stands after the change: the new item when one replaced another. */
  item_id: z.uuid(),
  label: z.string().min(1),
  action: UpdateItemAction,
  /** One line, written by the server from the change. */
  summary: z.string().min(1).max(200),
});
export type ItineraryChange = z.infer<typeof ItineraryChange>;

/** Card `itinerary_change` (design §2.1 `update_item`). */
export const ItineraryChangeCard = z.object({
  card_type: z.literal("itinerary_change"),
  requested_by_member_id: z.uuid(),
  changes: z.array(ItineraryChange).min(1),
});
export type ItineraryChangeCard = z.infer<typeof ItineraryChangeCard>;
