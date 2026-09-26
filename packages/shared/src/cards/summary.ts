import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const SummaryCard = z.looseObject({ card_type: z.literal("summary") });
export type SummaryCard = z.infer<typeof SummaryCard>;
