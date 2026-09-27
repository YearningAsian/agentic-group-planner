import { describe, expect, it } from "vitest";
import { checkTripView } from "./check";
import { bookedFixture, noAreaFixture, votingFixture } from "./fixtures";

describe("trip view", () => {
  it("checkTripView finds no problems in any fixture", () => {
    expect(checkTripView(votingFixture)).toEqual([]);
    expect(checkTripView(bookedFixture)).toEqual([]);
    expect(checkTripView(noAreaFixture)).toEqual([]);
  });

  it("checkTripView flags a dashed leg that ends at a place stop, and a solid leg that ends at a provisional one", () => {
    const dashedPlace = structuredClone(votingFixture);
    dashedPlace.legs[0]!.style = "dashed";
    expect(checkTripView(dashedPlace).some((p) => p.includes("dashed"))).toBe(true);

    const solidProvisional = structuredClone(votingFixture);
    const dinner = solidProvisional.legs.find((leg) => leg.toItemId === "dinner")!;
    dinner.style = "solid";
    expect(checkTripView(solidProvisional).some((p) => p.includes("solid"))).toBe(true);
  });

  it("checkTripView flags a leg whose endpoint has no stop", () => {
    const broken = structuredClone(votingFixture);
    broken.legs[0]!.toItemId = "missing";
    expect(checkTripView(broken).some((p) => p.includes("missing"))).toBe(true);
  });

  it("the voting fixture has one provisional stop in Midtown, 4 dashed legs into it, 1 branch, and 1 merge", () => {
    const provisional = Object.values(votingFixture.stops).filter((s) => s.kind === "provisional");
    expect(provisional).toHaveLength(1);
    expect(provisional[0]).toMatchObject({ label: "Dinner, TBD", area: "Midtown" });
    expect(votingFixture.legs.filter((leg) => leg.style === "dashed")).toHaveLength(4);
    expect(votingFixture.legs).toHaveLength(12);
    expect(votingFixture.branches).toHaveLength(1);
    expect(votingFixture.merges).toHaveLength(1);
  });

  it("the booked fixture has no provisional stop and no dashed legs", () => {
    expect(Object.values(bookedFixture.stops).every((s) => s.kind === "place")).toBe(true);
    expect(bookedFixture.legs.every((leg) => leg.style === "solid")).toBe(true);
    expect(bookedFixture.legs).toHaveLength(12);
  });

  it("the no-area fixture has no dinner stop and 8 legs", () => {
    expect(noAreaFixture.stops.dinner).toBeUndefined();
    expect(noAreaFixture.legs).toHaveLength(8);
  });
});
