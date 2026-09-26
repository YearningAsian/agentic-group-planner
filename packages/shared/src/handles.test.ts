import { describe, expect, it } from "vitest";
import { formatHandle, parseHandle } from "./handles";

describe("handles", () => {
  it("parseHandle accepts M1, I12, O3, and P9, and rejects X1, M0, and I-1", () => {
    expect(parseHandle("M1")).toEqual({ kind: "M", index: 1 });
    expect(parseHandle("I12")).toEqual({ kind: "I", index: 12 });
    expect(parseHandle("O3")).toEqual({ kind: "O", index: 3 });
    expect(parseHandle("P9")).toEqual({ kind: "P", index: 9 });
    for (const bad of ["X1", "M0", "I-1", "M01", "m1", "M", " M1"]) {
      expect(parseHandle(bad), bad).toBeNull();
    }
  });

  it("formatHandle is the inverse of parseHandle", () => {
    expect(formatHandle("I", 12)).toBe("I12");
    expect(parseHandle(formatHandle("P", 4))).toEqual({ kind: "P", index: 4 });
    expect(() => formatHandle("M", 0)).toThrow();
  });
});
