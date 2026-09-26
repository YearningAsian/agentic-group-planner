import { describe, expect, it } from "vitest";
import { optionReasoning } from "./reasoning";

const group = [
  { name: "Person 1", interests: ["art", "history", "food"] },
  { name: "Person 2", interests: ["outdoors", "animals"] },
  { name: "Person 3", interests: ["animals", "outdoors", "shopping"] },
];

describe("optionReasoning", () => {
  it("names the best interest match, the price, and the travel minutes", () => {
    // Person 2 and Person 3 both match two tags; the first in member order wins, and the cents show.
    expect(
      optionReasoning({
        place: { tags: ["animals", "outdoors", "family"], rating: 4.5 },
        priceCents: 1850,
        members: group,
        travel: { minutes: 12, mode: "walking" },
      }),
    ).toBe("Best fit for Person 2's interests (outdoors, animals) · $18.50 · 12 min walk");

    expect(
      optionReasoning({
        place: { tags: ["art", "museums", "history"], rating: 4.7 },
        priceCents: 4200,
        members: group,
        travel: { minutes: 25, mode: "driving" },
      }),
    ).toBe("Best fit for Person 1's interests (art, history) · $42 · 25 min drive");

    // No interest matches: the rating stands in. Free, and no previous stop to travel from.
    expect(
      optionReasoning({ place: { tags: ["gardens"], rating: 4.8 }, priceCents: 0, members: group, travel: null }),
    ).toBe("Rated 4.8 · Free");

    // Staying put, and nothing to say about fit.
    expect(
      optionReasoning({ place: { tags: [], rating: null }, priceCents: 1200, members: group, travel: { minutes: 0, mode: "walking" } }),
    ).toBe("$12 · Same place as before");
  });
});
