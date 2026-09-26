import { describe, expect, it } from "vitest";
import * as api from "./index";

describe("api barrel", () => {
  it("has one module per route group in design §2.4, and none for dropped flows", () => {
    const modules = Object.entries(api)
      .filter(([, value]) => typeof value === "object" && value !== null && !("parse" in value))
      .map(([name]) => name)
      .sort();
    expect(modules).toEqual(["demo", "health", "invites", "itinerary", "mandates", "messages", "profile", "trips"]);
  });
});
