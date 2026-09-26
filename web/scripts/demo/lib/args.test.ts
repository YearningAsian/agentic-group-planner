import { describe, expect, it } from "vitest";
import { stagesUpTo } from "../stages";
import { parseSeedArgs } from "./args";

describe("seed arguments", () => {
  it("reads --batch and --stage, and the batch defaults to demo", () => {
    expect(parseSeedArgs([])).toEqual({ batch: "demo", stage: undefined, all: false });
    expect(parseSeedArgs(["--batch", "dev-co", "--stage", "booked"])).toMatchObject({ batch: "dev-co", stage: "booked" });
  });

  it("runs stages in order up to the one requested", () => {
    expect(stagesUpTo(undefined)).toEqual([]);
    expect(stagesUpTo("planned")).toEqual(["planned"]);
    expect(stagesUpTo("discussed")).toEqual(["planned", "discussed"]);
    expect(stagesUpTo("booked")).toEqual(["planned", "discussed", "booked"]);
  });

  it("refuses --stage on the demo batch", () => {
    expect(() => parseSeedArgs(["--stage", "planned"])).toThrow(/demo batch/);
    expect(() => parseSeedArgs(["--batch", "demo", "--stage=booked"])).toThrow(/demo batch/);
  });

  it("reads --batch, --stage, and --all in either form", () => {
    expect(parseSeedArgs(["--batch", "dev-vo", "--stage=planned"])).toEqual({ batch: "dev-vo", stage: "planned", all: false });
    expect(parseSeedArgs(["--stage=planned", "--batch", "dev-vo"])).toMatchObject({ batch: "dev-vo", stage: "planned" });
    expect(parseSeedArgs(["--batch=e2e-a1b2", "--all"])).toEqual({ batch: "e2e-a1b2", stage: undefined, all: true });
  });

  it("rejects an unknown stage, an unsafe batch name, and unknown flags", () => {
    expect(() => parseSeedArgs(["--batch", "dev-vo", "--stage", "voted"])).toThrow(/planned, discussed, or booked/);
    expect(() => parseSeedArgs(["--batch", "Robert'); drop table"])).toThrow(/batch/);
    expect(() => parseSeedArgs(["--batch"])).toThrow(/batch/);
    expect(() => parseSeedArgs(["--force"])).toThrow(/--force/);
  });
});
