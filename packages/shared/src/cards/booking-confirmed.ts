import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const BookingConfirmedCard = z.looseObject({ card_type: z.literal("booking_confirmed") });
export type BookingConfirmedCard = z.infer<typeof BookingConfirmedCard>;
