import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const PlaceListCard = z.looseObject({ card_type: z.literal("place_list") });
export type PlaceListCard = z.infer<typeof PlaceListCard>;
