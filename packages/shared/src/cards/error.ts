import { z } from "zod";
import { ToolErrorCode } from "../tool-result";

/**
 * Written when a tool or a run fails, so users always see something. "Try again" re-sends the
 * message named by `retry_message_id` with a new client ID.
 */
export const ErrorCard = z.object({
  card_type: z.literal("error"),
  code: ToolErrorCode,
  message: z.string().min(1),
  tool: z.string().nullable(),
  retryable: z.boolean(),
  retry_message_id: z.uuid().nullable(),
});
export type ErrorCard = z.infer<typeof ErrorCard>;
