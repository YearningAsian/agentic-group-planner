import { describe, expect, it } from "vitest";
import { mockPlaceSuggestionsProvider } from "./mock";

describe("mock place suggestions provider", () => {
  it("returns Lisbon with its IATA code for a city query", async () => {
    const results = await mockPlaceSuggestionsProvider.suggest("lisb");
    expect(results[0]).toMatchObject({
      kind: "city",
      name: "Lisbon",
      iataCode: "LIS",
      airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport" }],
    });
  });

  it("returns a city with several airports so a later flight search can use any of them", async () => {
    const results = await mockPlaceSuggestionsProvider.suggest("london");
    const london = results.find((item) => item.iataCode === "LON");
    expect(london?.kind).toBe("city");
    expect(london?.airports.map((airport) => airport.iataCode)).toEqual(["LHR", "LGW", "STN"]);
  });

  it("returns an empty list for a blank query", async () => {
    await expect(mockPlaceSuggestionsProvider.suggest("")).resolves.toEqual([]);
  });
});
