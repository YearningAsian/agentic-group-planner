import { z } from "zod";
import { Cents } from "../common";
import { PriceAction } from "../enums";

/** Written by the server when the merchant's price moves between the quote and the booking. */
export const PriceChangeCard = z
  .object({
    card_type: z.literal("price_change"),
    price_change_id: z.uuid(),
    mandate_id: z.uuid(),
    old_cents: Cents,
    new_cents: Cents,
    action: PriceAction,
    /** The mandate that asks everyone again; set only when the new price is above the cap. */
    new_mandate_id: z.uuid().nullable(),
  })
  .refine((c) => (c.action === "reapproval_requested") === (c.new_mandate_id !== null), {
    message: "a re-approval names its new mandate, and nothing else does",
    path: ["new_mandate_id"],
  });
export type PriceChangeCard = z.infer<typeof PriceChangeCard>;
