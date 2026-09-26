export interface AirportCode {
  iataCode: string;
  name: string;
}

export interface PlaceSuggestion {
  kind: "city" | "airport";
  name: string;
  iataCode: string;
  airports: AirportCode[];
  lat: number | null;
  lng: number | null;
}

export interface PlaceSuggestionsProvider {
  suggest(query: string): Promise<PlaceSuggestion[]>;
}
