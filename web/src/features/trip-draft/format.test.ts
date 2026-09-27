import { describe, expect, it } from "vitest";
import { questionnaireBrief, stayOverBudget, type QuestionnaireBriefInput } from "./format";

describe("stayOverBudget", () => {
  it("uses the stay total for the trip instead of nightly price alone", () => {
    expect(stayOverBudget(100, 3, 250)).toBe(true);
    expect(stayOverBudget(100, 2, 250)).toBe(false);
  });

  it("treats a missing budget as not over budget", () => {
    expect(stayOverBudget(500, 5, null)).toBe(false);
  });
});

function answers(overrides: Partial<QuestionnaireBriefInput> = {}): QuestionnaireBriefInput {
  return {
    destinationId: "lisbon",
    destinationLabel: "Lisbon",
    destinationIata: "LIS",
    startDate: "2026-06-01",
    endDate: "2026-06-04",
    roundTrip: true,
    placesToVisit: "",
    stayPreference: "",
    budget: 1200,
    dietary: ["Vegetarian"],
    vibes: ["Food", "Nightlife"],
    members: [
      { name: "Alex", placeholder: false },
      { name: "Sam", placeholder: false },
      { name: "Jordan", placeholder: true },
    ],
    ...overrides,
  };
}

describe("questionnaireBrief", () => {
  it("names the place, asks for airports, and includes visit and stay notes", () => {
    expect(
      questionnaireBrief(
        answers({
          placesToVisit: "Fushimi Inari",
          stayPreference: "a quiet ryokan near the station",
        }),
      ),
    ).toBe(
      "Plan a trip to Lisbon, Jun 1–4, round trip. Recommend the airports. Budget is $1,200 per person. They want to visit: Fushimi Inari. Recommend places that match. Stay: a quiet ryokan near the station.",
    );
  });

  it("uses the fixture city and omits a blank visit or stay", () => {
    expect(questionnaireBrief(answers({ destinationLabel: "", destinationIata: null }))).toBe(
      "Plan a trip to Lisbon, Jun 1–4, round trip. Recommend the airports. Budget is $1,200 per person.",
    );
  });

  it("names the starting place when one was picked", () => {
    expect(questionnaireBrief(answers({ originLabel: "New York" }))).toBe(
      "Plan a trip from New York to Lisbon, Jun 1–4, round trip. Recommend the airports. Budget is $1,200 per person.",
    );
  });

  it("describes a one-way departure without a return date", () => {
    expect(questionnaireBrief(answers({ roundTrip: false, endDate: "" }))).toBe(
      "Plan a trip to Lisbon, Jun 1, one way. Recommend the airports. Budget is $1,200 per person.",
    );
  });
});
