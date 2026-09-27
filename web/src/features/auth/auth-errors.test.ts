import { describe, expect, it } from "vitest";
import { messageForAuthError } from "./auth-errors";

describe("auth errors", () => {
  it("Supabase error codes map to the wrong-password, unconfirmed, and rate-limit messages", () => {
    expect(messageForAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toMatch(
      /email or password/i,
    );
    expect(messageForAuthError({ code: "email_not_confirmed", message: "Email not confirmed" })).toMatch(/confirm/i);
    expect(messageForAuthError({ code: "over_request_rate_limit", message: "rate" })).toMatch(/too many/i);
    expect(messageForAuthError({ status: 429, message: "rate" })).toMatch(/too many/i);
    expect(messageForAuthError({ message: "something else" })).toMatch(/try again/i);
  });
});
