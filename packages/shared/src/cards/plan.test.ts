import { describe, expect, it } from "vitest";
import { PlanCard } from "./plan";
import { planCardFixture } from "./fixtures";

describe("plan card", () => {
  it("the plan card requires applied_plan_rank = 1", () => {
    expect(PlanCard.safeParse(planCardFixture).success).toBe(true);
    expect(PlanCard.safeParse({ ...planCardFixture, applied_plan_rank: 2 }).success).toBe(false);
  });

  it("a replan card must list its changes", () => {
    expect(PlanCard.safeParse({ ...planCardFixture, mode: "replan" }).success).toBe(false);
    expect(PlanCard.safeParse({ ...planCardFixture, mode: "replan", changes: [] }).success).toBe(true);
  });
});
