import { describe, expect, it } from "vitest";
import type { FlightOffer } from "@/lib/providers/flights/types";
import type { StayCard } from "@/lib/providers/stays/types";
import { flightExceedsBudget, relevantOffers, stayExceedsBudget } from "./browse-offers";

function stay(nightly: number, currency = "USD"): StayCard {
  return {
    id: String(nightly),
    name: String(nightly),
    image: null,
    area: "Center",
    guestScore: null,
    reviewCount: null,
    starRating: null,
    nightlyAmount: nightly,
    currency,
  };
}

function flight(price: number, currency = "USD"): FlightOffer {
  return {
    airline: "Test",
    origin: "JFK",
    destination: "LIS",
    departureTime: "2026-06-01T08:00:00",
    arrivalTime: "2026-06-01T18:00:00",
    stops: 0,
    price,
    totalPrice: price,
    currency,
  };
}

describe("relevantOffers", () => {
  it("drops stays whose trip total is over the per-person budget", () => {
    const stays = [stay(200), stay(80)];
    const picked = relevantOffers(
      stays,
      (card) => stayExceedsBudget(card, 3, 300),
      (card) => card.nightlyAmount ?? Number.POSITIVE_INFINITY,
    );
    expect(picked.relaxed).toBe(false);
    expect(picked.items.map((card) => card.nightlyAmount)).toEqual([80]);
  });

  it("keeps the cheapest stays when nothing fits the budget", () => {
    const stays = [stay(200), stay(150)];
    const picked = relevantOffers(
      stays,
      (card) => stayExceedsBudget(card, 3, 100),
      (card) => card.nightlyAmount ?? Number.POSITIVE_INFINITY,
    );
    expect(picked.relaxed).toBe(true);
    expect(picked.items.map((card) => card.nightlyAmount)).toEqual([150, 200]);
  });

  it("leaves non-USD flight prices in the list", () => {
    expect(flightExceedsBudget(flight(900, "EUR"), 400)).toBe(false);
    expect(flightExceedsBudget(flight(900), 400)).toBe(true);
  });
});
