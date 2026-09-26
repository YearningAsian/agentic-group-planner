import "server-only";
import { AppError } from "@/lib/reliability";

/**
 * Maps a write function's `code: message` exception to an AppError, as apply_plan's wrapper does.
 * Anything else is an unexpected database failure.
 */
export function rpcError(error: { message: string; code?: string }): AppError {
  const match = /^(not_permitted|conflict|invalid_input):\s*(.*)$/.exec(error.message);
  if (match) return new AppError(match[1] as "not_permitted" | "conflict" | "invalid_input", match[2] ?? error.message);
  if (error.code === "42501") return new AppError("not_permitted", error.message);
  return new AppError("internal", "The database write failed.", { retryable: true, cause: error });
}

/** A failed read on the payments path: transient as far as the caller can tell. */
export function readError(error: unknown, what = "the trip"): AppError {
  return new AppError("internal", `Couldn't read ${what}.`, { retryable: true, cause: error });
}
