import { describe, expect, it } from "vitest";
import { decimalToCents } from "./decimal";

describe("decimalToCents", () => {
  it.each([
    ["123.45", 12345],
    ["799.00", 79900],
    ["799.0", 79900],
    ["799", 79900],
    ["0.07", 7],
    ["0", 0],
    ["90071992547409.91", 9007199254740991],
  ])("%s → %d", (amount, cents) => {
    expect(decimalToCents(amount)).toBe(cents);
  });

  it.each(["1.234", "-1.00", "1e3", " 1.00", "1,000.00", "", ".50", "1.", "NaN", "90071992547409.92"])("rejects %j", (amount) => {
    expect(() => decimalToCents(amount)).toThrow(RangeError);
  });
});
