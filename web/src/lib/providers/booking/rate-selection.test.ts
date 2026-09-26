import { describe, expect, it } from "vitest";
import { approvalDeadline, bookingOptionId } from "./rate-selection";

const selected = {
  provider: "duffel_stays",
  raw: {
    rate_id: "rat_1", item_id: "item_1", trip_id: "trip_1",
    check_in_date: "2026-10-03", check_out_date: "2026-10-05", guests: 3,
    expires_at: "2026-10-01T14:00:00.000Z", total_cents: 12001, price_cents: 4001,
  },
};
const input = {
  bookingProvider: "duffel_stays" as const, optionId: "option-uuid", place: selected,
  itemId: "item_1", tripId: "trip_1", startsAt: "2026-10-03T22:00:00Z",
  endsAt: "2026-10-05T15:00:00Z", guests: 3, timezone: "America/New_York", now: Date.parse("2026-09-26T12:00:00Z"),
};

describe("selected hotel rate", () => {
  it("uses the selected place's Duffel rate ID when requesting a quote", () => {
    expect(bookingOptionId(input)).toBe("rat_1");
  });

  it("refuses a stale or differently scoped rate before any provider quote", () => {
    for (const mismatch of [
      { guests: 2 }, { itemId: "item_2" }, { tripId: "trip_2" },
      { startsAt: "2026-10-04T22:00:00Z" }, { endsAt: "2026-10-06T15:00:00Z" },
      { now: Date.parse("2026-10-01T14:00:00Z") },
      { place: { ...selected, provider: "mock" } },
      { place: { ...selected, raw: { ...selected.raw, rate_id: "" } } },
      { place: { ...selected, raw: { ...selected.raw, price_cents: 1 } } },
    ]) {
      expect(() => bookingOptionId({ ...input, ...mismatch })).toThrow();
    }
  });

  it("matches the stay by the trip's local dates, so an evening check-in isn't the next UTC day", () => {
    // 9 pm in New York on October 3 is already October 4 in UTC.
    expect(bookingOptionId({ ...input, startsAt: "2026-10-04T01:00:00Z" })).toBe("rat_1");
  });

  it("refuses a Duffel rate when another merchant would book it", () => {
    expect(() => bookingOptionId({ ...input, bookingProvider: "stays_mock" })).toThrow(/no longer valid/);
  });

  it("keeps internal option IDs for the mock hotel merchant", () => {
    expect(bookingOptionId({ ...input, bookingProvider: "stays_mock", place: { provider: "mock", raw: null } })).toBe("option-uuid");
  });
});

describe("approvalDeadline", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");

  it("is the usual 24 hours for a mock merchant, or a Duffel rate that lives longer", () => {
    expect(approvalDeadline({ now })).toBe("2026-09-27T12:00:00.000Z");
    expect(approvalDeadline({ now, rateExpiresAt: "2026-09-30T12:00:00Z" })).toBe("2026-09-27T12:00:00.000Z");
  });

  it("ends ten minutes before a shorter-lived Duffel rate expires", () => {
    expect(approvalDeadline({ now, rateExpiresAt: "2026-09-26T15:00:00Z" })).toBe("2026-09-26T14:50:00.000Z");
  });

  it("refuses a rate that leaves under 15 minutes to approve", () => {
    expect(() => approvalDeadline({ now, rateExpiresAt: "2026-09-26T12:20:00Z" })).toThrow(/expires too soon/);
  });
});
