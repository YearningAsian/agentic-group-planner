import { describe, expect, it } from "vitest";
import { demoPasswordFor } from "./demo-credentials";

describe("demoPasswordFor", () => {
  it("is stable for one secret and email, so the seed and the sign-in agree", () => {
    expect(demoPasswordFor("person1@demo.agp.test", "secret-a")).toBe(demoPasswordFor("person1@demo.agp.test", "secret-a"));
  });

  it("ignores email case and surrounding space", () => {
    expect(demoPasswordFor(" Person1@Demo.AGP.test ", "secret-a")).toBe(demoPasswordFor("person1@demo.agp.test", "secret-a"));
  });

  it("differs per person and per secret, so the repo alone can't derive it", () => {
    const base = demoPasswordFor("person1@demo.agp.test", "secret-a");
    expect(demoPasswordFor("person2@demo.agp.test", "secret-a")).not.toBe(base);
    expect(demoPasswordFor("person1@demo.agp.test", "secret-b")).not.toBe(base);
  });

  it("is long enough for the 10-character minimum and has no secret in it", () => {
    const password = demoPasswordFor("person1@demo.agp.test", "secret-a");
    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(password).not.toContain("secret-a");
  });

  it("refuses an empty secret", () => {
    expect(() => demoPasswordFor("person1@demo.agp.test", "")).toThrow(/DEMO_SEED_SECRET/);
  });
});
