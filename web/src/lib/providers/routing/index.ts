import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { createMockRoutingProvider } from "./mock";
import { createOrsRoutingProvider } from "./real";
import type { RoutingProvider } from "./types";

export type * from "./types";
export { minutesFor, routeModeFor, straightLineMeters, WALKING_LIMIT_M } from "./distance";
// Also the offline estimate for a leg the cache doesn't have yet (travel edges, fixtures).
export { createMockRoutingProvider } from "./mock";

/** Picks the implementation from `ROUTING_PROVIDER`. Pure, so tests can pass any env. */
export function selectRoutingProvider(env: Pick<ServerEnv, "ROUTING_PROVIDER" | "ORS_API_KEY">): RoutingProvider {
  switch (env.ROUTING_PROVIDER) {
    case "mock":
      return createMockRoutingProvider();
    case "real":
      // The env schema already requires the key when the flag is real.
      return createOrsRoutingProvider({ apiKey: env.ORS_API_KEY ?? "" });
  }
}

let cached: RoutingProvider | undefined;

/** The provider for this process, chosen once from the validated env. */
export function getRoutingProvider(): RoutingProvider {
  cached ??= selectRoutingProvider(getServerEnv());
  return cached;
}
