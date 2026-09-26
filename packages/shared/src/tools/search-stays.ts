import { z } from "zod";
import { handleOf } from "../handles";

/**
 * Hotels for a lodging item (plan CO-S05). The server searches near the item's area for its
 * dates and party, and caches what it finds as places, so `plan_day` can offer them as options.
 */
export const SearchStaysInput = z.object({
  item_handle: handleOf("I"),
  max_results: z.number().int().min(1).max(6).default(5),
});
export type SearchStaysInput = z.infer<typeof SearchStaysInput>;
