import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const ApprovalCard = z.looseObject({ card_type: z.literal("approval") });
export type ApprovalCard = z.infer<typeof ApprovalCard>;
