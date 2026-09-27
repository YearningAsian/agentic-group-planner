import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/reliability";
import { plannerFailureMessage } from "./failure";
import { CHAT_BUSY, CHAT_TIMEOUT, CHAT_UNAVAILABLE } from "./types";

describe("plannerFailureMessage", () => {
  it("separates a rate limit from a timeout and hides unknown failures", () => {
    expect(plannerFailureMessage(new AppError("timeout", "slow"))).toBe(CHAT_TIMEOUT);
    expect(plannerFailureMessage({ name: "TimeoutError" })).toBe(CHAT_TIMEOUT);
    expect(plannerFailureMessage({ statusCode: 429 })).toBe(CHAT_BUSY);
    expect(plannerFailureMessage({ cause: { status: 429 } })).toBe(CHAT_BUSY);
    expect(plannerFailureMessage(new AppError("provider_unavailable", CHAT_UNAVAILABLE))).toBe(CHAT_UNAVAILABLE);
    expect(plannerFailureMessage(new Error("api key sk-secret"))).toBe(CHAT_UNAVAILABLE);
  });
});
