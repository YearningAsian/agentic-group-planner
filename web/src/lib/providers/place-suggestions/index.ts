import "server-only";
import type { ServerEnv } from "@/lib/env/server";
import { getServerEnv } from "@/lib/env/server";
import { mockPlaceSuggestionsProvider } from "./mock";
import { createDuffelPlaceSuggestions } from "./real";
import type { PlaceSuggestionsProvider } from "./types";

export type * from "./types";

export function getPlaceSuggestionsProvider(env: Pick<ServerEnv, "DUFFEL_ACCESS_TOKEN"> = getServerEnv()): PlaceSuggestionsProvider {
  if (env.DUFFEL_ACCESS_TOKEN) return createDuffelPlaceSuggestions({ token: env.DUFFEL_ACCESS_TOKEN });
  return mockPlaceSuggestionsProvider;
}
