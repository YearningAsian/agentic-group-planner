import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/reliability";
import { assignHandles, resolveHandle } from "./handles";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const members = [
  { id: uuid(3), sort_order: 3 },
  { id: uuid(1), sort_order: 1 },
  { id: uuid(4), sort_order: 4 },
  { id: uuid(2), sort_order: 2 },
];
const items = [
  { id: uuid(13), slot_key: "afternoon", starts_at: "2026-10-03T18:15:00+00:00", position: 1 },
  { id: uuid(11), slot_key: "morning", starts_at: "2026-10-03T14:00:00+00:00", position: 1 },
  // A split afternoon: the sibling starts at the same time, so position breaks the tie.
  { id: uuid(14), slot_key: "afternoon", starts_at: "2026-10-03T18:15:00+00:00", position: 2 },
  { id: uuid(12), slot_key: "lunch", starts_at: "2026-10-03T16:45:00+00:00", position: 1 },
];
const options = [
  { id: uuid(22), item_id: uuid(11), rank: 2, place_id: uuid(32) },
  { id: uuid(23), item_id: uuid(12), rank: 1, place_id: uuid(33) },
  { id: uuid(21), item_id: uuid(11), rank: 1, place_id: uuid(31) },
  // The same place offered in two slots gets one P handle.
  { id: uuid(24), item_id: uuid(12), rank: 2, place_id: uuid(31) },
];

describe("assignHandles", () => {
  it("assigns M# by sort_order, I# by starts_at, and O# by rank, identically on repeated calls", () => {
    const { table } = assignHandles({ members, items, options });

    expect(table).toMatchObject({
      M1: uuid(1),
      M2: uuid(2),
      M3: uuid(3),
      M4: uuid(4),
      I1: uuid(11),
      I2: uuid(12),
      I3: uuid(13),
      I4: uuid(14),
      // Options follow their items, then rank.
      O1: uuid(21),
      O2: uuid(22),
      O3: uuid(23),
      O4: uuid(24),
      // Places in the order the options first name them.
      P1: uuid(31),
      P2: uuid(32),
      P3: uuid(33),
    });
    expect(Object.keys(table)).toHaveLength(15);

    const reversed = assignHandles({ members: [...members].reverse(), items: [...items].reverse(), options: [...options].reverse() });
    expect(reversed.table).toEqual(table);
    expect(reversed.byId).toEqual(assignHandles({ members, items, options }).byId);
  });

  it("byId maps each uuid back to its handle", () => {
    const { byId } = assignHandles({ members, items, options });
    expect(byId[uuid(1)]).toBe("M1");
    expect(byId[uuid(14)]).toBe("I4");
    expect(byId[uuid(31)]).toBe("P1");
  });
});

describe("resolveHandle", () => {
  const { table } = assignHandles({ members, items, options });

  it("returns the uuid for a known handle", () => {
    expect(resolveHandle(table, "I2")).toBe(uuid(12));
    expect(resolveHandle(table, "M3", "M")).toBe(uuid(3));
  });

  it("resolveHandle on an unknown handle throws unknown_handle", () => {
    for (const handle of ["I9", "X1", "M0", "", "i1"]) {
      let thrown: unknown;
      try {
        resolveHandle(table, handle);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, handle).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("unknown_handle");
      expect((thrown as AppError).retryable).toBe(false);
    }
  });

  it("a handle of the wrong kind is unknown_handle, naming the expected kind", () => {
    expect(() => resolveHandle(table, "M1", "I")).toThrow(/I handle/);
  });
});
