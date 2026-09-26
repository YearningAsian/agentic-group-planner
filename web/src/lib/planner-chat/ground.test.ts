import { describe, expect, it } from "vitest";
import type { FlightOffer } from "@/lib/providers/flights/types";
import { decideReply, factsAreGrounded, mentionsTravelFact, offerRecommendation, SAFE_LINE } from "./ground";
import type { HotelOffer } from "./types";

const flight: FlightOffer = {
  airline: "Delta Air Lines",
  flightNumber: "DL123",
  origin: "ATL",
  destination: "MIA",
  departureTime: "2026-10-15T08:20:00",
  arrivalTime: "2026-10-15T10:05:00",
  stops: 0,
  price: 179,
  totalPrice: 179,
  currency: "USD",
};

const hotel: HotelOffer = {
  name: "The Example Hotel",
  location: "South Beach",
  pricePerNight: 179,
  totalPrice: 537,
  currency: "USD",
  rating: 8.8,
  amenities: ["Pool"],
};

describe("travel fact gate", () => {
  it("treats a fare as a fact and a date question as not one", () => {
    expect(mentionsTravelFact("Delta is $400.")).toBe(true);
    expect(mentionsTravelFact("What dates are you traveling?")).toBe(false);
    expect(decideReply("Delta is $400.", false, [], [])).toEqual({ action: "retry" });
    expect(decideReply("What dates are you traveling?", false, [], [])).toEqual({
      action: "send",
      text: "What dates are you traveling?",
    });
  });

  it("replaces a price that is not in the Duffel payload with the real offer", () => {
    const text = offerRecommendation([flight], []);
    expect(decideReply("Delta is $400 and leaves at 8:20.", true, [flight], [])).toEqual({
      action: "send",
      text,
    });
    expect(text).toContain("Delta Air Lines");
    expect(text).toContain("$179");
    expect(factsAreGrounded(text, [flight], [])).toBe(true);
  });

  it("recommends the cheapest nonstop and the best-rated hotel", () => {
    const text = offerRecommendation([flight], [hotel]);
    expect(text).toContain("Stay at The Example Hotel in South Beach for $179 a night.");
    expect(factsAreGrounded(text, [flight], [hotel])).toBe(true);
    expect(decideReply("", true, [], [])).toEqual({ action: "send", text: SAFE_LINE });
  });

  it("keeps a reply whose price, time, and hotel name are in the payload", () => {
    const text = "The Example Hotel is $179 a night in South Beach. Delta Air Lines leaves at 8:20.";
    expect(decideReply(text, true, [flight], [hotel])).toEqual({ action: "send", text });
  });

  it("uses a fixed line when the model will not drop an invented fact", () => {
    expect(SAFE_LINE).not.toMatch(/\$\d/);
  });
});
