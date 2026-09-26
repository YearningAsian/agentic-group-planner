import { withPolicy } from "@/lib/reliability/with-policy";
import type { AirportCode, PlaceSuggestion, PlaceSuggestionsProvider } from "./types";

// Duffel isolates test and live data. This adapter only accepts a duffel_test_ token
// (enforced in web/src/lib/env/server.ts). Never put a duffel_live_ token in DUFFEL_ACCESS_TOKEN.
const POLICY = { timeoutMs: 4000, retries: 0 } as const;

interface DuffelAirport {
  iata_code?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}

interface DuffelPlace {
  type?: string;
  iata_code?: string;
  name?: string;
  city_name?: string;
  latitude?: number;
  longitude?: number;
  airports?: DuffelAirport[];
}

export function createDuffelPlaceSuggestions(opts: {
  token: string;
  fetchImpl?: typeof fetch;
}): PlaceSuggestionsProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async suggest(query) {
      const q = query.trim();
      if (q.length === 0) return [];
      const url = new URL("https://api.duffel.com/places/suggestions");
      url.searchParams.set("query", q);

      const body = await withPolicy(async (signal) => {
        const response = await fetchImpl(url.toString(), {
          signal,
          headers: {
            Authorization: `Bearer ${opts.token}`,
            "Duffel-Version": "v2",
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        }
        return (await response.json()) as { data?: DuffelPlace[] };
      }, POLICY);

      return (body.data ?? []).flatMap(toSuggestion);
    },
  };
}

function toSuggestion(place: DuffelPlace): PlaceSuggestion[] {
  const iataCode = place.iata_code;
  if (!iataCode) return [];
  const kind = place.type === "airport" ? "airport" : "city";
  const name = place.name ?? place.city_name ?? iataCode;
  const cityName = place.city_name?.trim() || undefined;
  const nested = (place.airports ?? [])
    .filter((airport): airport is DuffelAirport & { iata_code: string } => Boolean(airport.iata_code))
    .map((airport) => ({
      iataCode: airport.iata_code,
      name: airport.name ?? airport.iata_code,
      ...(airport.latitude != null && airport.longitude != null
        ? { lat: airport.latitude, lng: airport.longitude }
        : {}),
    }));
  const airports: AirportCode[] = nested.length > 0 ? nested : [{ iataCode, name }];
  return [
    {
      kind,
      name,
      ...(cityName ? { cityName } : {}),
      iataCode,
      lat: place.latitude ?? null,
      lng: place.longitude ?? null,
      airports,
    },
  ];
}
