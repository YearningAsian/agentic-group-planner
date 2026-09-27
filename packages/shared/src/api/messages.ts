import { z } from "zod";

/** `POST /api/messages`: a member's chat message or item comment (design §2.4). */
export const SendMessageRequest = z.object({
  /** A UUID from the client, so a retried or double-tapped send makes one message. */
  client_id: z.uuid(),
  trip_id: z.uuid(),
  body: z.string().trim().min(1).max(2000),
  /** Set for a comment on an itinerary item. */
  item_id: z.uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const SendMessageResponse = z.object({
  message_id: z.uuid(),
  /** The queued agent run when the body mentions @agent. */
  agent_run_id: z.uuid().nullable(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;
