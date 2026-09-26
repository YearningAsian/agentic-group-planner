import { z } from "zod";
import { handleOf } from "../handles";

/**
 * `propose_purchase` input (design §2.1). There is deliberately no amount field: the server gets
 * the quote from the merchant and splits it, so the model can never name a price. Unknown keys are
 * stripped, so an `amount_cents` the model invents never reaches the handler.
 */
export const ProposePurchaseInput = z.object({
  /** Must be `decided`, with a chosen option priced above 0. */
  item_handle: handleOf("I"),
  /** Defaults to the item's chosen option. */
  option_handle: handleOf("O").optional(),
  /** Defaults to `trips.price_threshold_percent` (110). */
  cap_percent: z.number().int().min(100).max(125).optional(),
  /** Shown on the approval card. */
  note: z.string().max(200).optional(),
});
export type ProposePurchaseInput = z.infer<typeof ProposePurchaseInput>;
