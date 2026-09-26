import { describe, expect, it } from "vitest";
import { unchangedSlots, type LiveSlotItem } from "./replan-keep";

const everyone = ["m1", "m2", "m3"];
const group = (member_ids: string[], ...places: string[]) => ({
  member_ids,
  options: places.map((place_id, i) => ({ place_id, rank: i + 1 })),
});
const voting = (id: string, best: string, attendees: string[] = []): LiveSlotItem => ({ id, slot_key: "lunch", status: "voting", attendees, best_place_id: best });
const decided = (id: string, chosen: string, attendees: string[] = []): LiveSlotItem => ({ id, slot_key: "lunch", status: "decided", attendees, best_place_id: chosen });

describe("unchangedSlots", () => {
  it("keeps a voting slot whose group and top option are the same as before", () => {
    const kept = unchangedSlots({ everyone, live: [voting("i1", "pA")], answer: [{ slot_key: "lunch", groups: [group(everyone, "pA", "pB")] }] });
    expect([...kept]).toEqual(["lunch"]);
  });

  it("keeps a decided slot whose chosen place is the new top option", () => {
    const kept = unchangedSlots({ everyone, live: [decided("i1", "pA")], answer: [{ slot_key: "lunch", groups: [group(["m3", "m1", "m2"], "pA", "pB")] }] });
    expect(kept.has("lunch")).toBe(true);
  });

  it("replaces a slot whose top option changed", () => {
    const kept = unchangedSlots({ everyone, live: [decided("i1", "pA")], answer: [{ slot_key: "lunch", groups: [group(everyone, "pB", "pA")] }] });
    expect(kept.size).toBe(0);
  });

  it("an item without attendee rows counts as everyone together", () => {
    const kept = unchangedSlots({ everyone, live: [voting("i1", "pA")], answer: [{ slot_key: "lunch", groups: [group(["m1", "m2"], "pA"), group(["m3"], "pC")] }] });
    expect(kept.size).toBe(0);
  });

  it("keeps a split slot only when every group matches an item with the same members and top option", () => {
    const live = [voting("i1", "pA", ["m1", "m2"]), voting("i2", "pC", ["m3"])];
    const same = [{ slot_key: "lunch", groups: [group(["m3"], "pC"), group(["m2", "m1"], "pA", "pB")] }];
    expect(unchangedSlots({ everyone, live, answer: same }).has("lunch")).toBe(true);

    const regrouped = [{ slot_key: "lunch", groups: [group(["m1"], "pA"), group(["m2", "m3"], "pC")] }];
    expect(unchangedSlots({ everyone, live, answer: regrouped }).size).toBe(0);

    const merged = [{ slot_key: "lunch", groups: [group(everyone, "pA")] }];
    expect(unchangedSlots({ everyone, live, answer: merged }).size).toBe(0);
  });

  it("never keeps a slot with an open item or no known best option", () => {
    const tbd: LiveSlotItem = { id: "i1", slot_key: "lunch", status: "tbd", attendees: [], best_place_id: null };
    const answer = [{ slot_key: "lunch", groups: [group(everyone, "pA")] }];
    expect(unchangedSlots({ everyone, live: [tbd], answer }).size).toBe(0);
    expect(unchangedSlots({ everyone, live: [{ ...voting("i1", "pA"), best_place_id: null }], answer }).size).toBe(0);
  });
});
