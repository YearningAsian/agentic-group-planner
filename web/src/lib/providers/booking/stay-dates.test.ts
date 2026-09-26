import { describe, expect, it } from "vitest";
import { stayDates } from "./stay-dates";

describe("stayDates", () => {
  it("an evening check-in is that local night, not the next UTC day", () => {
    // 9 pm in New York and 6 pm in Los Angeles are both 01:00Z on the next day.
    expect(stayDates("2026-10-04T01:00:00Z", "2026-10-05T15:00:00Z", "America/New_York")).toEqual({ checkIn: "2026-10-03", checkOut: "2026-10-05" });
    expect(stayDates("2026-10-04T01:00:00Z", "2026-10-05T18:00:00Z", "America/Los_Angeles")).toEqual({ checkIn: "2026-10-03", checkOut: "2026-10-05" });
  });

  it("refuses a stay whose local check-out isn't after its check-in", () => {
    expect(() => stayDates("2026-10-03T10:00:00Z", "2026-10-03T20:00:00Z", "UTC")).toThrow(/at least one night/);
  });
});
