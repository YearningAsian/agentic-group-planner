export interface AirportCode {
  iataCode: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}

export interface PlaceSuggestion {
  kind: "city" | "airport";
  name: string;
  /** Set on airport hits so the questionnaire can offer the place instead of the airport. */
  cityName?: string;
  iataCode: string;
  airports: AirportCode[];
  lat: number | null;
  lng: number | null;
}

export interface PlaceSuggestionsProvider {
  suggest(query: string): Promise<PlaceSuggestion[]>;
}
