import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const CallStatusCard = z.looseObject({ card_type: z.literal("call_status") });
export type CallStatusCard = z.infer<typeof CallStatusCard>;
