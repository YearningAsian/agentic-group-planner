import { describe, expect, it } from "vitest";
import * as api from "./index";

describe("api barrel", () => {
  it("has one module per route group in design §2.4, and none for dropped flows", () => {
    // `export * as name` re-exports a module namespace object, which is tagged "Module".
    const modules = Object.entries(api)
      .filter(([, value]) => (value as { [Symbol.toStringTag]?: string } | null)?.[Symbol.toStringTag] === "Module")
      .map(([name]) => name)
      .sort();
    expect(modules).toEqual(["demo", "health", "invites", "itinerary", "mandates", "messages", "profile", "trips"]);
  });
});
