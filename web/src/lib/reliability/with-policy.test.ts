import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./app-error";
import { withPolicy } from "./with-policy";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** An error shaped like a failed HTTP response. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A call that fails with each error in turn, then succeeds, recording when it was called. */
function flaky(errors: unknown[]) {
  const calledAt: number[] = [];
  const fn = vi.fn(async () => {
    calledAt.push(Date.now());
    const error = errors[calledAt.length - 1];
    if (error) throw error;
    return "ok";
  });
  return { fn, calledAt };
}

describe("withPolicy", () => {
  it("times out after timeoutMs with code timeout, retryable true", async () => {
    let aborted = false;
    const promise = withPolicy(
      (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(signal.reason)))),
      { timeoutMs: 1000, retries: 0 },
    );
    const caught = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "timeout", retryable: true });
    expect(aborted).toBe(true);
  });

  it("retries 429, 5xx, and network errors with 400 ms × 2^n backoff", async () => {
    const network = new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
    const { fn, calledAt } = flaky([httpError(429), httpError(503), network]);
    const start = Date.now();
    const promise = withPolicy(fn, { timeoutMs: 5000, retries: 3 });
    await vi.advanceTimersByTimeAsync(400 + 800 + 1600);
    await expect(promise).resolves.toBe("ok");
    expect(calledAt.map((t) => t - start)).toEqual([0, 400, 1200, 2800]);
  });

  it("does not retry other 4xx errors", async () => {
    const notFound = httpError(404);
    const { fn } = flaky([notFound]);
    await expect(withPolicy(fn, { timeoutMs: 5000, retries: 2 })).rejects.toBe(notFound);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries: 0 calls exactly once", async () => {
    const { fn } = flaky([httpError(503)]);
    const error = await withPolicy(fn, { timeoutMs: 5000, retries: 0 }).catch((e: unknown) => e);
    expect(fn).toHaveBeenCalledTimes(1);
    // A transient failure that exhausts its retries surfaces as provider_unavailable.
    expect(error).toMatchObject({ code: "provider_unavailable", retryable: true });
  });
});
