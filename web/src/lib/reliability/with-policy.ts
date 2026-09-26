import { AppError } from "./app-error";

export interface Policy {
  /** Per attempt. The attempt's signal aborts when it runs out. */
  timeoutMs: number;
  /** Extra attempts after the first. 0 means exactly one call. */
  retries: number;
  /** Base delay; attempt n waits backoffMs × 2^n. Default 400. */
  backoffMs?: number;
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE"]);

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  if (typeof code === "string" && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR"))) return true;
  // fetch() reports connection failures as a bare TypeError.
  return error instanceof TypeError && /fetch failed|network/i.test(error.message);
}

/** 429s, 5xx responses, network failures, and timeouts are transient; everything else isn't. */
export function isTransient(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  const status = statusOf(error);
  if (status !== undefined) return status === 429 || status >= 500;
  return isNetworkError(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = new AppError("timeout", `No response within ${timeoutMs} ms.`, { retryable: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps one external call with a timeout and retries. Transient failures that use up every retry
 * surface as `provider_unavailable` (or `timeout`); other errors are rethrown unchanged.
 */
export async function withPolicy<T>(fn: (signal: AbortSignal) => Promise<T>, policy: Policy): Promise<T> {
  const backoffMs = policy.backoffMs ?? 400;
  for (let n = 0; ; n++) {
    try {
      return await attempt(fn, policy.timeoutMs);
    } catch (error) {
      if (!isTransient(error)) throw error;
      if (n >= policy.retries) {
        if (error instanceof AppError) throw error;
        throw new AppError("provider_unavailable", "A service we depend on isn't responding. Try again.", {
          retryable: true,
          cause: error,
        });
      }
      await sleep(backoffMs * 2 ** n);
    }
  }
}
