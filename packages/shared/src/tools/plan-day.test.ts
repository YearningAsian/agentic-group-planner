import { describe, expect, it } from "vitest";
import { PlanDayInput } from "./plan-day";

describe("plan_day input", () => {
  it("plan_day rejects options_per_slot outside 2–3", () => {
    expect(PlanDayInput.safeParse({ mode: "initial", options_per_slot: 1 }).success).toBe(false);
    expect(PlanDayInput.safeParse({ mode: "initial", options_per_slot: 4 }).success).toBe(false);
    expect(PlanDayInput.safeParse({ mode: "initial", options_per_slot: 2 }).success).toBe(true);
    expect(PlanDayInput.parse({ mode: "initial" }).options_per_slot).toBe(3);
  });

  it("accepts the seeded prompt's constraint updates and rejects non-handle members", () => {
    const input = {
      mode: "initial",
      constraint_updates: [
        { member_handle: "all", budget_cents: 8000 },
        { member_handle: "M2", dietary: ["vegetarian"] },
      ],
      note: "Person 4 joins later",
    };
    expect(PlanDayInput.safeParse(input).success).toBe(true);
    const bad = { mode: "initial", constraint_updates: [{ member_handle: "Person 2" }] };
    expect(PlanDayInput.safeParse(bad).success).toBe(false);
    expect(PlanDayInput.safeParse({ mode: "initial", item_handles: ["M1"] }).success).toBe(false);
  });
});
