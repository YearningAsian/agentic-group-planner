import { describe, expect, it } from "vitest";
import { capFor, formatUsd, splitEvenly } from "./index";

describe("money", () => {
  it("splitEvenly(16800, 4) gives 4200 each", () => {
    expect(splitEvenly(16800, 4)).toEqual([4200, 4200, 4200, 4200]);
  });

  it("splitEvenly(10001, 3, 0) gives the organizer the extra cent", () => {
    expect(splitEvenly(10001, 3, 0)).toEqual([3335, 3333, 3333]);
    // Every leftover cent goes to the organizer, wherever they sit, and nothing is lost.
    const shares = splitEvenly(10002, 4, 2);
    expect(shares).toEqual([2500, 2500, 2502, 2500]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10002);
  });

  it("splitEvenly rejects fractional cents, no attendees, and an organizer outside the party", () => {
    expect(() => splitEvenly(100.5, 2)).toThrow(RangeError);
    expect(() => splitEvenly(-1, 2)).toThrow(RangeError);
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(100, 2, 2)).toThrow(RangeError);
  });

  it("capFor(4200, 110) is 4800", () => {
    expect(capFor(4200, 110)).toBe(4800);
    expect(() => capFor(4200, 130)).toThrow(RangeError);
  });

  it('formatUsd(9400) is "$94" and formatUsd(4250) is "$42.50"', () => {
    expect(formatUsd(9400)).toBe("$94");
    expect(formatUsd(4250)).toBe("$42.50");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
    expect(() => formatUsd(42.5)).toThrow(RangeError);
  });
});
