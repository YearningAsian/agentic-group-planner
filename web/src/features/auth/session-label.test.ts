import { describe, expect, it } from "vitest";
import { sessionLabel } from "./session-label";

describe("sessionLabel", () => {
  it("names the seeded people", () => {
    expect(sessionLabel("person1@demo.agp.test")).toBe("Person 1");
    expect(sessionLabel("person2@demo.agp.test")).toBe("Person 2");
  });

  it("returns null when nobody is signed in", () => {
    expect(sessionLabel(null)).toBeNull();
  });
});
