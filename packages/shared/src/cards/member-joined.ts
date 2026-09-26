import { z } from "zod";

/** Written by the server when a placeholder claims their lane; not a tool card. */
export const MemberJoinedCard = z.object({
  card_type: z.literal("member_joined"),
  member_id: z.uuid(),
  display_name: z.string().min(1),
  lane_color: z.string().min(1),
  /** Mandates now waiting for the joiner's own approval. */
  pending_mandate_ids: z.array(z.uuid()),
});
export type MemberJoinedCard = z.infer<typeof MemberJoinedCard>;
