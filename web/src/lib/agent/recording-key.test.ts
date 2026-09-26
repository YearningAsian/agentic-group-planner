import { describe, expect, it } from "vitest";
import { recordingFileName, recordingKey } from "./recording-key";

describe("recordingKey", () => {
  it('normalizes the plan prompt to "plan saturday 80 each person 2s vegetarian person 4 joins later"', () => {
    const prompt = "@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later.";
    expect(recordingKey(prompt)).toBe("plan saturday 80 each person 2s vegetarian person 4 joins later");
  });

  it("collapses whitespace and drops @agent wherever it appears", () => {
    expect(recordingKey("  Make   lunch\ncheaper, @Agent!  ")).toBe("make lunch cheaper");
  });

  it("keys a server-triggered run by its trigger and slot", () => {
    expect(recordingKey({ trigger: "price_change", slotKey: "Afternoon" })).toBe("price_change:afternoon");
  });
});

describe("recordingFileName", () => {
  it("replaces every character outside a-z0-9_ with a hyphen", () => {
    expect(recordingFileName("plan saturday 80 each person 2s vegetarian person 4 joins later")).toBe(
      "plan-saturday-80-each-person-2s-vegetarian-person-4-joins-later.json",
    );
    expect(recordingFileName("price_change:afternoon")).toBe("price_change-afternoon.json");
  });
});
