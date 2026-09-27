import { describe, expect, it } from "vitest";
import type { FlightOffer } from "@/lib/providers/flights/types";
import { decideClarification } from "./clarify";
import type { HotelOffer } from "./types";

const mariner: FlightOffer = {
  airline: "Mariner",
  origin: "JFK",
  destination: "MIA",
  departureTime: "2026-10-15T08:05:00",
  arrivalTime: "2026-10-15T11:15:00",
  duration: "3h 10m",
  stops: 0,
  price: 196,
  totalPrice: 196,
  currency: "USD",
};

const cedar: FlightOffer = {
  airline: "Cedar Air",
  origin: "JFK",
  destination: "MIA",
  departureTime: "2026-10-15T14:30:00",
  arrivalTime: "2026-10-15T19:05:00",
  duration: "4h 35m",
  stops: 1,
  price: 148,
  totalPrice: 148,
  currency: "USD",
};

const grove: HotelOffer = {
  id: "miami-stay-2",
  name: "Coconut Grove rooms",
  location: "Coconut Grove",
  pricePerNight: 210,
  totalPrice: 630,
  currency: "USD",
  rating: 4.9,
  amenities: [],
};

const wynwood: HotelOffer = {
  id: "miami-stay-1",
  name: "Wynwood loft",
  location: "Wynwood",
  pricePerNight: 148,
  totalPrice: 444,
  currency: "USD",
  rating: 4.86,
  amenities: [],
};

const readyTrip = {
  origin: "New York",
  destination: "Miami",
  startDate: "2026-10-15",
  endDate: "2026-10-18",
  budget: 800,
};

const offers = { flights: [mariner, cedar], hotels: [grove, wynwood] };

describe("decideClarification", () => {
  it("asks a price-or-time question from the sample fares before recommending", () => {
    const turn = decideClarification({
      fromQuestionnaire: true,
      clarifyCount: 0,
      trip: readyTrip,
      userTexts: ["Plan a trip to Miami."],
      searched: true,
      ...offers,
    });
    expect(turn.action).toBe("ask");
    if (turn.action !== "ask") return;
    expect(turn.text).toContain("Mariner");
    expect(turn.text).toContain("$196");
    expect(turn.text).toContain("Cedar Air");
    expect(turn.text).toContain("$148");
    expect(turn.text).toContain("$48");
    expect(turn.text).toMatch(/price or time/i);
  });

  it("asks the hotel tradeoff second, using neighborhood, price, and guest score", () => {
    const turn = decideClarification({
      fromQuestionnaire: true,
      clarifyCount: 1,
      trip: readyTrip,
      userTexts: ["Plan a trip to Miami.", "the cheaper one"],
      searched: true,
      ...offers,
    });
    expect(turn.action).toBe("ask");
    if (turn.action !== "ask") return;
    expect(turn.text).toContain("Coconut Grove rooms");
    expect(turn.text).toContain("Coconut Grove");
    expect(turn.text).toContain("$210");
    expect(turn.text).toContain("4.9");
    expect(turn.text).toContain("Wynwood loft");
    expect(turn.text).toContain("$148");
    expect(turn.text).toContain("4.86");
  });

  it("commits one flight and one hotel after the answers, and at the cap without a clear side", () => {
    const chosen = decideClarification({
      fromQuestionnaire: true,
      clarifyCount: 2,
      trip: readyTrip,
      userTexts: ["Plan a trip to Miami.", "cheaper", "the guest score"],
      searched: true,
      ...offers,
    });
    expect(chosen).toMatchObject({
      action: "commit",
      flight: cedar,
      hotel: grove,
    });
    if (chosen.action !== "commit") return;
    expect(chosen.text).toMatch(/based on that, i'd go with/i);
    expect(chosen.text).toContain("Cedar Air");
    expect(chosen.text).toContain("Coconut Grove rooms");

    const fallback = decideClarification({
      fromQuestionnaire: true,
      clarifyCount: 2,
      trip: readyTrip,
      userTexts: ["Plan a trip to Miami.", "either is fine", "not sure"],
      searched: true,
      ...offers,
    });
    expect(fallback).toMatchObject({ action: "commit", flight: mariner, hotel: grove });
  });

  it("commits immediately when the catalog has no tradeoff", () => {
    const turn = decideClarification({
      fromQuestionnaire: true,
      clarifyCount: 0,
      trip: readyTrip,
      userTexts: ["Plan a trip to Miami."],
      searched: true,
      flights: [mariner],
      hotels: [grove],
    });
    expect(turn).toMatchObject({ action: "commit", flight: mariner, hotel: grove });
  });

  it("asks one baseline question when the questionnaire was skipped, then still caps at three", () => {
    const open = decideClarification({
      fromQuestionnaire: false,
      clarifyCount: 0,
      trip: { destination: "Miami" },
      userTexts: ["Miami"],
      searched: false,
      flights: [],
      hotels: [],
    });
    expect(open).toEqual({ action: "ask", text: "Where are you flying from?" });

    const priced = { ...readyTrip, budget: null };
    const firstNarrow = decideClarification({
      fromQuestionnaire: false,
      clarifyCount: 1,
      trip: priced,
      userTexts: ["Miami", "$800"],
      searched: true,
      ...offers,
    });
    expect(firstNarrow.action).toBe("ask");
    if (firstNarrow.action === "ask") expect(firstNarrow.text).toMatch(/price or time/i);

    const forced = decideClarification({
      fromQuestionnaire: false,
      clarifyCount: 3,
      trip: priced,
      userTexts: ["Miami", "$800", "whatever", "whatever"],
      searched: true,
      ...offers,
    });
    expect(forced.action).toBe("commit");
  });

  it("searches once the questionnaire already has a destination, origin, and dates", () => {
    expect(
      decideClarification({
        fromQuestionnaire: true,
        clarifyCount: 0,
        trip: readyTrip,
        userTexts: ["Plan a trip to Miami."],
        searched: false,
        flights: [],
        hotels: [],
      }),
    ).toEqual({ action: "search" });
  });
});
