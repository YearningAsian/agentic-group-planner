import { AppError } from "./app-error";

const RAISED = /^(not_permitted|conflict|invalid_input|not_found|domain_rule):\s*([\s\S]*)$/;

/**
 * Maps a write function's raised `code: message` exception (design §3.4) to an AppError, so a
 * correctable one reaches the model as its ToolError. Anything else is an unexpected database
 * failure, shown as a generic message.
 */
export function rpcError(error: { message: string; code?: string }): AppError {
  const match = RAISED.exec(error.message);
  if (match) return new AppError(match[1] as "not_permitted" | "conflict" | "invalid_input" | "not_found" | "domain_rule", match[2] || error.message);
  if (error.code === "42501") return new AppError("not_permitted", "That isn't permitted.");
  return new AppError("internal", "The database write failed.", { retryable: true, cause: error });
}
