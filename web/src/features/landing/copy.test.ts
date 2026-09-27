import { describe, expect, it } from "vitest";
import { allLandingCopy, BANNED_LANDING_TERMS, pairsAgentWithPaid } from "./copy";

describe("landing copy", () => {
  it("no landing copy pairs the agent with paying, and none names a dropped feature", () => {
    const strings = allLandingCopy();
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) {
      expect(pairsAgentWithPaid(text), text).toBe(false);
      const lower = text.toLowerCase();
      for (const banned of BANNED_LANDING_TERMS) {
        expect(lower.includes(banned), `${banned} in: ${text}`).toBe(false);
      }
    }
    // Money framing must appear at least once.
    expect(strings.some((text) => text.includes("Agent proposed · You approve"))).toBe(true);
  });
});
