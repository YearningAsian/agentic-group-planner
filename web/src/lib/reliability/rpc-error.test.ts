import { describe, expect, it } from "vitest";
import { rpcError } from "./rpc-error";

describe("rpcError", () => {
  it("maps a raised code and keeps its message", () => {
    expect(rpcError({ message: "not_permitted: only the organizer locks an option", code: "42501" })).toMatchObject({
      code: "not_permitted",
      message: "only the organizer locks an option",
    });
    expect(rpcError({ message: "conflict: this item is already TBD", code: "P0001" })).toMatchObject({ code: "conflict" });
  });

  it("hides anything else behind a retryable internal error", () => {
    const error = rpcError({ message: 'duplicate key value violates unique constraint "x"', code: "23505" });
    expect(error).toMatchObject({ code: "internal", message: "The database write failed.", retryable: true });
    // An unlabelled permission error doesn't leak the raw database message.
    expect(rpcError({ message: "permission denied for function apply_plan", code: "42501" })).toMatchObject({
      code: "not_permitted",
      message: "That isn't permitted.",
    });
  });
});
