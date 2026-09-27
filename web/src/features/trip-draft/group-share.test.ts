import { describe, expect, it } from "vitest";
import type { ChosenFlight, ChosenStay } from "@/features/trip-draft/chosen-travel";
import { quoteShares } from "./group-share";

const dates = { startDate: "2026-06-01", endDate: "2026-06-04" };

const liveFlight: ChosenFlight = {
  id: "live-flight",
  airline: "TAP",
  origin: "JFK",
  destination: "LIS",
  departure: "2026-06-01T08:00:00",
  arrival: "2026-06-01T18:00:00",
  stops: 0,
  price: 400,
  currency: "USD",
};

const liveStay: ChosenStay = {
  id: "live-stay",
  name: "Harbor Test Hotel",
  area: "Alfama",
  nightlyAmount: 210,
  currency: "USD",
  guestScore: null,
  image: null,
};

describe("quoteShares", () => {
  it("prices fixture picks from the catalog, including hotel nights", () => {
    const quote = quoteShares({
      destinationId: "lisbon",
      ...dates,
      members: [{ id: "p1", name: "Person 1", flightId: "lisbon-flight-0", stayId: "lisbon-stay-0" }],
      chosenFlight: { ...liveFlight, id: "lisbon-flight-0", price: 1 },
      chosenStay: { ...liveStay, id: "lisbon-stay-0", nightlyAmount: 1 },
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.nights).toBe(3);
    expect(quote.shares[0]).toMatchObject({ flightCents: 54800, stayCents: 50400, totalCents: 105200, currency: "USD" });
    expect(quote.totalCents).toBe(105200);
  });

  it("prices a live lock when the pick is not a fixture", () => {
    const quote = quoteShares({
      destinationId: "lisbon",
      ...dates,
      members: [{ id: "p1", name: "Person 1", flightId: liveFlight.id, stayId: liveStay.id }],
      chosenFlight: liveFlight,
      chosenStay: liveStay,
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.shares[0]?.totalCents).toBe(40000 + 21000 * 3);
  });

  it("refuses a share whose flight and hotel currencies differ", () => {
    const quote = quoteShares({
      destinationId: "lisbon",
      ...dates,
      members: [{ id: "p1", name: "Ada", flightId: liveFlight.id, stayId: liveStay.id }],
      chosenFlight: liveFlight,
      chosenStay: { ...liveStay, currency: "EUR" },
    });

    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.message).toMatch(/different currencies/);
  });
});
