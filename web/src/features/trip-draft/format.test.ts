import { describe, expect, it } from "vitest";
import { stayOverBudget } from "./format";

describe("stayOverBudget", () => {
  it("uses the stay total for the trip instead of nightly price alone", () => {
    expect(stayOverBudget(100, 3, 250)).toBe(true);
    expect(stayOverBudget(100, 2, 250)).toBe(false);
  });

  it("treats a missing budget as not over budget", () => {
    expect(stayOverBudget(500, 5, null)).toBe(false);
  });
});
