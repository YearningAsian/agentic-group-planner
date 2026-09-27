import { AppError } from "@/lib/reliability";
import { CHAT_BUSY, CHAT_TIMEOUT, CHAT_UNAVAILABLE } from "./types";

export function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

/** A message safe to show in the studio. Timeouts and rate limits stay distinct from an outage. */
export function plannerFailureMessage(error: unknown): string {
  if (isTimeout(error)) return CHAT_TIMEOUT;
  if (httpStatus(error) === 429) return CHAT_BUSY;
  if (error instanceof AppError) return error.message;
  return CHAT_UNAVAILABLE;
}

function isTimeout(error: unknown): boolean {
  if (error instanceof AppError && error.code === "timeout") return true;
  return (error as { name?: unknown } | null)?.name === "TimeoutError";
}

function httpStatus(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { status?: unknown; statusCode?: unknown; cause?: unknown };
    const status = record.statusCode ?? record.status;
    if (typeof status === "number") return status;
    current = record.cause;
  }
  return undefined;
}
