import "server-only";
import type { RouteMode } from "@agp/shared";
import { getRoutingProvider, routeModeFor, type RouteResult, type RoutingProvider } from "@/lib/providers/routing";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";

/** A leg between two cached places, by `places.id`. */
export interface PlacePair {
  from: string;
  to: string;
}

export interface RouteLeg extends RouteResult {
  mode: RouteMode;
}

export interface EnsureRoutesDeps {
  admin?: AdminClient;
  provider?: RoutingProvider;
}

/** The map key for a leg: `${from}:${to}`. */
export const legKey = (from: string, to: string) => `${from}:${to}`;

function readFailed(what: string, cause: unknown): AppError {
  return new AppError("internal", `Couldn't read the ${what}.`, { retryable: true, cause });
}

/**
 * Returns a route for every pair, keyed `from:to`, from the `routes` cache when it has one and
 * from the routing provider otherwise (design §2.3). Each leg is walked under 1.5 km and driven
 * beyond. Only the misses are fetched, and they're upserted, so the next caller finds them.
 * Same-place pairs and pairs naming an unknown place are skipped. A leg the provider fails on is
 * left out rather than failing the rest: the map draws it as a straight line without a time (§7.4).
 */
export async function ensureRoutes(pairs: PlacePair[], deps: EnsureRoutesDeps = {}): Promise<Map<string, RouteLeg>> {
  const admin = deps.admin ?? getAdminClient();
  const wanted = new Map<string, PlacePair>();
  for (const pair of pairs) if (pair.from !== pair.to) wanted.set(legKey(pair.from, pair.to), pair);
  const legs = new Map<string, RouteLeg>();
  if (wanted.size === 0) return legs;

  const placeIds = [...new Set([...wanted.values()].flatMap((p) => [p.from, p.to]))];
  const { data: places, error: placeError } = await admin.from("places").select("id, lat, lng").in("id", placeIds);
  if (placeError) throw readFailed("places", placeError);
  const where = new Map(places.map((p) => [p.id, { lat: p.lat, lng: p.lng }]));

  const modes = new Map<string, RouteMode>();
  for (const [key, pair] of wanted) {
    const from = where.get(pair.from);
    const to = where.get(pair.to);
    if (from && to) modes.set(key, routeModeFor(from, to));
  }

  const { data: cached, error: cacheError } = await admin
    .from("routes")
    .select("from_place_id, to_place_id, mode, geometry, duration_s, distance_m")
    .in("from_place_id", [...new Set([...wanted.values()].map((p) => p.from))])
    .in("to_place_id", [...new Set([...wanted.values()].map((p) => p.to))]);
  if (cacheError) throw readFailed("route cache", cacheError);
  for (const row of cached) {
    const key = legKey(row.from_place_id, row.to_place_id);
    if (modes.get(key) !== row.mode) continue;
    legs.set(key, {
      mode: row.mode as RouteMode,
      geometry: row.geometry as unknown as RouteLeg["geometry"],
      durationS: row.duration_s,
      distanceM: row.distance_m,
    });
  }

  const misses = [...modes].filter(([key]) => !legs.has(key));
  if (misses.length === 0) return legs;
  const provider = deps.provider ?? getRoutingProvider();
  const fetched = await Promise.allSettled(
    misses.map(async ([key, mode]) => {
      const pair = wanted.get(key)!;
      const result = await provider.route({ from: where.get(pair.from)!, to: where.get(pair.to)!, mode });
      return { key, pair, leg: { mode, ...result } };
    }),
  );
  const fetchedAt = new Date().toISOString();
  const rows = [];
  for (const outcome of fetched) {
    if (outcome.status === "rejected") {
      // An outage or an unroutable leg; anything else is a bug and should surface.
      if (outcome.reason instanceof AppError) continue;
      throw outcome.reason;
    }
    const { key, pair, leg } = outcome.value;
    legs.set(key, leg);
    rows.push({
      from_place_id: pair.from,
      to_place_id: pair.to,
      mode: leg.mode,
      geometry: leg.geometry,
      duration_s: leg.durationS,
      distance_m: leg.distanceM,
      provider: provider.name,
      fetched_at: fetchedAt,
    });
  }
  if (rows.length > 0) {
    // Two callers may fetch the same leg at once; either row is a good answer.
    const { error } = await admin.from("routes").upsert(rows, { onConflict: "from_place_id,to_place_id,mode" });
    if (error) throw new AppError("internal", "Couldn't save the routes.", { retryable: true, cause: error });
  }
  return legs;
}
