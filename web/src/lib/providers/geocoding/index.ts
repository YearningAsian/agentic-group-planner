import "server-only";
import { isLiveMapboxToken } from "@/lib/mapbox/token";
import { getClientEnv } from "@/lib/env/client";
import { mockGeocodingProvider } from "./mock";
import { createMapboxGeocoding } from "./real";
import type { GeocodingProvider } from "./types";

export type * from "./types";

export function getGeocodingProvider(token = getClientEnv().NEXT_PUBLIC_MAPBOX_TOKEN): GeocodingProvider {
  if (isLiveMapboxToken(token)) return createMapboxGeocoding({ token });
  return mockGeocodingProvider;
}
