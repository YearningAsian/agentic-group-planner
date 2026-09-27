import { describe, expect, it } from "vitest";
import { chatRequestSchema, flightDateError, flightSearchSchema, hotelDateError, hotelSearchSchema } from "./schema";

const flight = {
  origin: "ATL",
  destination: "Miami",
  departureDate: "2026-10-15",
  travelers: 4,
};

describe("planner chat parameters", () => {
  it("rejects a hotel search with no guests and a checkout on the check-in day", () => {
    expect(hotelSearchSchema.safeParse({ destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 0 }).success).toBe(
      false,
    );
    expect(hotelSearchSchema.safeParse({ destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2, rooms: 12 }).success).toBe(
      false,
    );
    const parsed = hotelSearchSchema.parse({ destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-15", guests: 2 });
    expect(hotelDateError(parsed)).toMatch(/check-out/i);
  });

  it("rejects a flight search that names a url or an impossible cabin", () => {
    expect(flightSearchSchema.safeParse({ ...flight, url: "https://example.test" }).success).toBe(false);
    expect(flightSearchSchema.safeParse({ ...flight, cabinClass: "private" }).success).toBe(false);
    const parsed = flightSearchSchema.parse({ ...flight, returnDate: "2026-10-15" });
    expect(flightDateError(parsed)).toMatch(/return date/i);
  });

  it("accepts a short chat turn and drops nothing required", () => {
    const parsed = chatRequestSchema.parse({
      messages: [{ role: "user", text: "We're trying to go to Miami in October." }],
      trip: { destination: "", members: ["Alex"], budget: null },
    });
    expect(parsed.messages).toHaveLength(1);
  });
});
