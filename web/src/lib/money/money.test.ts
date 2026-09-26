import { describe, expect, it } from "vitest";
import { capFor, formatUsd, splitEvenly } from "./index";

describe("splitEvenly", () => {
  it("splitEvenly(16800, 4) gives 4200 each", () => {
    expect(splitEvenly(16800, 4)).toEqual([4200, 4200, 4200, 4200]);
  });

  it("splitEvenly(10001, 3, 0) gives the organizer the extra cent", () => {
    expect(splitEvenly(10001, 3, 0)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(10001, 3, 2)).toEqual([3333, 3333, 3334]);
  });

  it("hands out a larger remainder one cent at a time, starting with the organizer, and always sums to the total", () => {
    const shares = splitEvenly(10003, 4, 2);

    expect(shares).toEqual([2501, 2500, 2501, 2501]);
    expect(shares.reduce((sum, cents) => sum + cents, 0)).toBe(10003);
  });

  it("rejects amounts that aren't integer cents and counts below 1", () => {
    expect(() => splitEvenly(100.5, 2)).toThrow(RangeError);
    expect(() => splitEvenly(-100, 2)).toThrow(RangeError);
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(100, 2, 2)).toThrow(RangeError);
  });
});

describe("capFor", () => {
  it("capFor(4200, 110) is 4800", () => {
    expect(capFor(4200, 110)).toBe(4800);
  });
});

describe("formatUsd", () => {
  it('formatUsd(9400) is "$94" and formatUsd(4250) is "$42.50"', () => {
    expect(formatUsd(9400)).toBe("$94");
    expect(formatUsd(4250)).toBe("$42.50");
  });

  it("groups thousands, keeps cents to two digits, and signs refunds", () => {
    expect(formatUsd(123456705)).toBe("$1,234,567.05");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(-4250)).toBe("-$42.50");
  });

  it("rejects a fractional cent, which would mean money math happened in floats", () => {
    expect(() => formatUsd(42.5)).toThrow(RangeError);
  });
});
