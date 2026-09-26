import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./args";

describe("seed arguments", () => {
  it("defaults to the demo batch and no stage", () => {
    expect(parseSeedArgs([])).toEqual({ batch: "demo", stage: undefined, all: false });
  });

  it("reads --batch, --stage, and --all in either form", () => {
    expect(parseSeedArgs(["--batch", "dev-vo", "--stage=planned"])).toEqual({ batch: "dev-vo", stage: "planned", all: false });
    expect(parseSeedArgs(["--batch=e2e-a1b2", "--all"])).toEqual({ batch: "e2e-a1b2", stage: undefined, all: true });
  });

  it("rejects an unknown stage, an unsafe batch name, and unknown flags", () => {
    expect(() => parseSeedArgs(["--stage", "voted"])).toThrow(/planned, discussed, or booked/);
    expect(() => parseSeedArgs(["--batch", "Robert'); drop table"])).toThrow(/batch/);
    expect(() => parseSeedArgs(["--batch"])).toThrow(/batch/);
    expect(() => parseSeedArgs(["--force"])).toThrow(/--force/);
  });
});
