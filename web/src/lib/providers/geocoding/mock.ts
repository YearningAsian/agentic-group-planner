import type { GeocodeSuggestion, GeocodingProvider } from "./types";

const FIXTURES: GeocodeSuggestion[] = [
  {
    label: "123 Mission St, San Francisco, CA 94105, United States",
    lat: 37.7935,
    lng: -122.396,
  },
  {
    label: "1600 Pennsylvania Avenue NW, Washington, DC 20500, United States",
    lat: 38.8977,
    lng: -77.0365,
  },
  {
    label: "10 Downing Street, London, SW1A 2AA, United Kingdom",
    lat: 51.5034,
    lng: -0.1276,
  },
];

export const mockGeocodingProvider: GeocodingProvider = {
  async suggest(query) {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return FIXTURES.filter((item) => item.label.toLowerCase().includes(q));
  },
};
