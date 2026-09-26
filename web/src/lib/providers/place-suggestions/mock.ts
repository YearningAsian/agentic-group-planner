import type { PlaceSuggestion, PlaceSuggestionsProvider } from "./types";

const FIXTURES: PlaceSuggestion[] = [
  {
    kind: "city",
    name: "Lisbon",
    iataCode: "LIS",
    lat: 38.7223,
    lng: -9.1393,
    airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport" }],
  },
  {
    kind: "city",
    name: "London",
    iataCode: "LON",
    lat: 51.5074,
    lng: -0.1278,
    airports: [
      { iataCode: "LHR", name: "Heathrow" },
      { iataCode: "LGW", name: "Gatwick" },
      { iataCode: "STN", name: "Stansted" },
    ],
  },
  {
    kind: "airport",
    name: "Heathrow",
    iataCode: "LHR",
    lat: 51.47,
    lng: -0.4543,
    airports: [{ iataCode: "LHR", name: "Heathrow" }],
  },
  {
    kind: "city",
    name: "Kyoto",
    iataCode: "UKY",
    lat: 35.0116,
    lng: 135.7681,
    airports: [{ iataCode: "KIX", name: "Kansai International" }],
  },
  {
    kind: "city",
    name: "Mexico City",
    iataCode: "MEX",
    lat: 19.4326,
    lng: -99.1332,
    airports: [{ iataCode: "MEX", name: "Mexico City International" }],
  },
];

export const mockPlaceSuggestionsProvider: PlaceSuggestionsProvider = {
  async suggest(query) {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return FIXTURES.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.iataCode.toLowerCase().includes(q) ||
        item.airports.some((airport) => airport.iataCode.toLowerCase().includes(q) || airport.name.toLowerCase().includes(q)),
    );
  },
};
