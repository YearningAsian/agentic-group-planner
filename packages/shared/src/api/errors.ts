import { z } from "zod";

/** HTTP error codes the routes return, each with its status. */
export const ApiErrorCode = z.enum([
  "invalid_input",
  "unauthenticated",
  "not_permitted",
  "not_found",
  "conflict",
  "domain_rule",
  "provider_unavailable",
  "timeout",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Every error response body: `{ error: { code, message, retryable } }`. */
export const ApiErrorBody = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string(), retryable: z.boolean() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
