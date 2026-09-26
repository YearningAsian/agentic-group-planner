import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const PriceChangeCard = z.looseObject({ card_type: z.literal("price_change") });
export type PriceChangeCard = z.infer<typeof PriceChangeCard>;
