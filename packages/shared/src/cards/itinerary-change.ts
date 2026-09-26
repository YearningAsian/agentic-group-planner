import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const ItineraryChangeCard = z.looseObject({ card_type: z.literal("itinerary_change") });
export type ItineraryChangeCard = z.infer<typeof ItineraryChangeCard>;
