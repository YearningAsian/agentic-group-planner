import { describe, expect, it } from "vitest";
import { AppError, toHttpError, toToolError } from "./app-error";

describe("AppError", () => {
  it("toHttpError maps conflict to 409 and provider_unavailable to 502", () => {
    expect(toHttpError(new AppError("conflict", "The item is already booked."))).toEqual({
      status: 409,
      body: { error: { code: "conflict", message: "The item is already booked.", retryable: false } },
    });
    expect(toHttpError(new AppError("provider_unavailable", "The planner is down.", { retryable: true })).status).toBe(502);
    expect(toHttpError(new AppError("invalid_input", "Bad body")).status).toBe(400);
    expect(toHttpError(new AppError("not_permitted", "Not a member")).status).toBe(403);
    expect(toHttpError(new AppError("timeout", "Slow")).status).toBe(504);
  });

  it("hides unexpected errors behind a generic 500", () => {
    const { status, body } = toHttpError(new Error("connection string with a password"));
    expect(status).toBe(500);
    expect(body.error).toEqual({ code: "internal", message: "Something went wrong.", retryable: true });
  });

  it("toToolError keeps tool codes and folds HTTP-only codes into them", () => {
    expect(toToolError(new AppError("unknown_handle", "No I9"))).toEqual({ code: "unknown_handle", message: "No I9", retryable: false });
    expect(toToolError(new AppError("unauthenticated", "No session")).code).toBe("not_permitted");
    expect(toToolError(new Error("boom"))).toEqual({ code: "internal", message: "Something went wrong.", retryable: true });
  });
});
