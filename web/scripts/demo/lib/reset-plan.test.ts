import { describe, expect, it } from "vitest";
import { resetPlan } from "./reset-plan";

const users = [
  // Seeded users of this batch, and a claimer who joined as Person 4.
  { id: "u-p1", email: "person1.dev-vo@demo.agp.test", seed_batch: "dev-vo" },
  { id: "u-p2", email: "person2.dev-vo@demo.agp.test", seed_batch: "dev-vo" },
  { id: "u-claimer", email: "someone@example.test", seed_batch: "dev-vo" },
  // Another batch's seeded user and claimer, and a user with no batch.
  { id: "u-other", email: "person1.dev-fe@demo.agp.test", seed_batch: "dev-fe" },
  { id: "u-other-claimer", email: "x@example.test", seed_batch: "dev-fe" },
  { id: "u-real", email: "real@example.test", seed_batch: null },
];

describe("resetPlan", () => {
  it("deletes only the batch's trips and claimers, never seeded users or other batches", () => {
    const plan = resetPlan({ batch: "dev-vo", all: false, users });

    expect(plan.deleteTripsOfBatch).toBe("dev-vo");
    expect(plan.deleteUserIds).toEqual(["u-claimer"]);
    expect(plan.deleteSeedPlaces).toBe(false);
    expect(plan.deleteRoutesOfSeedPlaces).toBe(false);
    expect(plan.deleteStoragePrefix).toBeNull();
    expect(plan.reseedSteps).toEqual([4, 5, 6]);
  });

  it("--all adds seeded users, places, routes, and storage objects", () => {
    const plan = resetPlan({ batch: "dev-vo", all: true, users });

    expect(plan.deleteUserIds.sort()).toEqual(["u-claimer", "u-p1", "u-p2"]);
    expect(plan.deleteSeedPlaces).toBe(true);
    expect(plan.deleteRoutesOfSeedPlaces).toBe(true);
    expect(plan.deleteStoragePrefix).toBe("dev-vo/");
    expect(plan.reseedSteps).toEqual([1, 3, 4, 5, 6]);
  });

  it("the demo batch keeps its unsuffixed seeded emails", () => {
    const demo = [
      { id: "d1", email: "person1@demo.agp.test", seed_batch: "demo" },
      { id: "d-claimer", email: "claimer@example.test", seed_batch: "demo" },
    ];
    expect(resetPlan({ batch: "demo", all: false, users: demo }).deleteUserIds).toEqual(["d-claimer"]);
  });
});
