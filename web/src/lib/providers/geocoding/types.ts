export interface GeocodeSuggestion {
  label: string;
  lat: number;
  lng: number;
}

export interface GeocodingProvider {
  suggest(query: string): Promise<GeocodeSuggestion[]>;
}
