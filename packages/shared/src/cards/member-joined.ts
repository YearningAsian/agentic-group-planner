import { z } from "zod";

// Stub: the final export name and card_type, with loose fields until this card's owner fills it in.
export const MemberJoinedCard = z.looseObject({ card_type: z.literal("member_joined") });
export type MemberJoinedCard = z.infer<typeof MemberJoinedCard>;
