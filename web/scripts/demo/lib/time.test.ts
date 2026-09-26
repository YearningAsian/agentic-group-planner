import { describe, expect, it } from "vitest";
import { localToUtc, nextSaturday } from "./time";

describe("seed dates", () => {
  it("the trip is the next Saturday after seeding, in the trip's time zone", () => {
    // Friday evening in New York is already Saturday in UTC; the trip is still the next day there.
    expect(nextSaturday(new Date("2026-09-26T02:00:00Z"), "America/New_York")).toBe("2026-09-26");
    // On a Saturday, "next" means a week later.
    expect(nextSaturday(new Date("2026-09-26T15:00:00Z"), "America/New_York")).toBe("2026-10-03");
    expect(nextSaturday(new Date("2026-09-28T12:00:00Z"), "America/New_York")).toBe("2026-10-03");
  });

  it("local wall-clock times become UTC instants, across daylight saving", () => {
    expect(localToUtc("2026-10-03", "10:00", "America/New_York")).toBe("2026-10-03T14:00:00.000Z");
    expect(localToUtc("2026-11-07", "10:00", "America/New_York")).toBe("2026-11-07T15:00:00.000Z");
    expect(localToUtc("2026-10-03", "19:00", "Europe/London")).toBe("2026-10-03T18:00:00.000Z");
  });
});
