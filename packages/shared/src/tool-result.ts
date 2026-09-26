import { z } from "zod";

export const ToolErrorCode = z.enum([
  "invalid_input",
  "unknown_handle",
  "not_permitted",
  "conflict",
  "provider_unavailable",
  "timeout",
  "internal",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCode>;

export const ToolError = z.object({
  code: ToolErrorCode,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ToolError = z.infer<typeof ToolError>;

/** What the model sees after a tool call. The card goes to the chat; this goes back to the model. */
export const ToolResult = z
  .object({
    ok: z.boolean(),
    summary: z.string().max(600),
    handles: z.record(z.string(), z.string()).optional(),
    card_message_id: z.uuid().optional(),
    error: ToolError.optional(),
  })
  .refine((r) => r.ok || r.error !== undefined, { message: "a failed result needs an error", path: ["error"] });
export type ToolResult = z.infer<typeof ToolResult>;
