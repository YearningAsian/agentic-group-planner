import { withPolicy } from "@/lib/reliability/with-policy";
import type { GeocodeSuggestion, GeocodingProvider } from "./types";

const POLICY = { timeoutMs: 5000, retries: 1 } as const;

interface MapboxFeature {
  properties?: {
    full_address?: string;
    name?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
  geometry?: { coordinates?: [number, number] };
}

export function createMapboxGeocoding(opts: {
  token: string;
  fetchImpl?: typeof fetch;
}): GeocodingProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async suggest(query) {
      const q = query.trim();
      if (q.length === 0) return [];
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.searchParams.set("q", q);
      url.searchParams.set("autocomplete", "true");
      url.searchParams.set("limit", "5");
      url.searchParams.set("types", "address,street");
      url.searchParams.set("access_token", opts.token);

      const body = await withPolicy(async (signal) => {
        const response = await fetchImpl(url.toString(), { signal });
        if (!response.ok) {
          throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        }
        return (await response.json()) as { features?: MapboxFeature[] };
      }, POLICY);

      return (body.features ?? []).flatMap((feature) => {
        const label = feature.properties?.full_address ?? feature.properties?.name;
        const lat = feature.properties?.coordinates?.latitude ?? feature.geometry?.coordinates?.[1];
        const lng = feature.properties?.coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
        if (!label || lat == null || lng == null) return [];
        return [{ label, lat, lng }];
      });
    },
  };
}
