import { describe, expect, it } from "vitest";
import { assembleItinerary, type ItineraryRows, toIcs } from "./build-itinerary-export";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [p1, p2, p3, p4] = [id(1), id(2), id(3), id(4)];

const rows: ItineraryRows = {
  trip: { id: id(100), title: "Saturday in Atlanta", city: "Atlanta", trip_date: "2026-10-03", timezone: "America/New_York" },
  memberId: p2,
  members: [
    { id: p1, display_name: "Person 1" },
    { id: p2, display_name: "Person 2" },
    { id: p3, display_name: "Person 3" },
    { id: p4, display_name: "Person 4" },
  ],
  items: [
    // Listed out of order: the export sorts by start time.
    { id: id(13), slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:15:00Z", ends_at: "2026-10-03T21:15:00Z", status: "voting", chosen_option_id: null, area_label: null },
    { id: id(11), slot_key: "morning", label: "Morning", starts_at: "2026-10-03T14:00:00Z", ends_at: "2026-10-03T16:30:00Z", status: "booked", chosen_option_id: id(21), area_label: null },
    { id: id(14), slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:15:00Z", ends_at: "2026-10-03T21:15:00Z", status: "voting", chosen_option_id: null, area_label: null },
    { id: id(15), slot_key: "dinner", label: "Dinner", starts_at: "2026-10-03T23:00:00Z", ends_at: "2026-10-04T00:30:00Z", status: "tbd", chosen_option_id: null, area_label: "Midtown" },
  ],
  attendees: [
    ...[p1, p2, p3, p4].map((m) => ({ item_id: id(11), member_id: m })),
    { item_id: id(13), member_id: p2 },
    { item_id: id(13), member_id: p3 },
    // The other side of the split: Person 2 isn't there.
    { item_id: id(14), member_id: p1 },
    { item_id: id(14), member_id: p4 },
    ...[p1, p2, p3, p4].map((m) => ({ item_id: id(15), member_id: m })),
  ],
  places: [{ option_id: id(21), place_id: id(31), name: "Georgia Aquarium", address: "225 Baker St NW, Atlanta, GA 30313", lat: 33.7634, lng: -84.3951 }],
  shares: [{ item_id: id(11), kind: "own", status: "captured", share_cents: 4200, cap_cents: 4800 }],
};

describe("assembleItinerary", () => {
  it("keeps only the member's attended items, in time order, with place, times, attendees, and payment status", () => {
    const itinerary = assembleItinerary(rows);

    expect(itinerary.member).toEqual({ member_id: p2, display_name: "Person 2" });
    expect(itinerary.stops.map((s) => s.item_id)).toEqual([id(11), id(13), id(15)]);
    const [morning, afternoon, dinner] = itinerary.stops;
    expect(morning).toMatchObject({
      label: "Morning",
      starts_at: "2026-10-03T14:00:00Z",
      place: { name: "Georgia Aquarium", address: "225 Baker St NW, Atlanta, GA 30313" },
      payment: { status: "paid", label: "Paid", share_cents: 4200 },
    });
    // Fellow attendees only, not the member themselves.
    expect(morning!.attendees.map((a) => a.display_name)).toEqual(["Person 1", "Person 3", "Person 4"]);
    expect(afternoon).toMatchObject({ place: null, payment: { status: "none" } });
    expect(afternoon!.attendees.map((a) => a.display_name)).toEqual(["Person 3"]);
    expect(dinner).toMatchObject({ area_label: "Midtown", place: null });
  });

  it("totals show the member's committed share and status", () => {
    expect(assembleItinerary(rows).totals).toEqual({ committed_cents: 4200, paid_cents: 4200, to_approve: 0, status: "all_paid" });

    const pending = { ...rows, shares: [{ item_id: id(11), kind: "own" as const, status: "pending", share_cents: 4200, cap_cents: 4800 }] };
    expect(assembleItinerary(pending).totals).toEqual({ committed_cents: 0, paid_cents: 0, to_approve: 1, status: "in_progress" });

    expect(assembleItinerary({ ...rows, shares: [] }).totals).toEqual({ committed_cents: 0, paid_cents: 0, to_approve: 0, status: "none" });
  });
});

describe("toIcs", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("the calendar file has one event per attended item, with the place and start/end times", () => {
    const ics = toIcs(assembleItinerary(rows), now);
    const lines = ics.split("\r\n");

    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(3);
    expect(ics).toContain(`UID:${id(11)}@agentic-group-planner`);
    expect(ics).toContain("DTSTART:20261003T140000Z");
    expect(ics).toContain("DTEND:20261003T163000Z");
    expect(ics).toContain("SUMMARY:Morning · Georgia Aquarium");
    expect(ics).toContain("LOCATION:Georgia Aquarium\\, 225 Baker St NW\\, Atlanta\\, GA 30313");
    expect(ics).toContain("SUMMARY:Dinner · Midtown (to be decided)");
    expect(ics).toContain("DTSTAMP:20260926T120000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long lines at 75 octets and escapes text", () => {
    const long = { ...rows, trip: { ...rows.trip, title: `A; very, long\ntitle ${"x".repeat(120)}` } };
    const ics = toIcs(assembleItinerary(long), now);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain("X-WR-CALNAME:A\\; very\\, long\\ntitle");
  });
});
