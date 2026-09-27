import "server-only";
import type { RouteMode } from "@agp/shared";
import {
  createMockRoutingProvider,
  getRoutingProvider,
  type LatLng,
  minutesFor,
  routeModeFor,
  type RouteResult,
  type RoutingProvider,
} from "@/lib/providers/routing";
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

interface Lookup {
  /** The distinct legs asked for, without same-place pairs. */
  wanted: Map<string, PlacePair>;
  where: Map<string, LatLng>;
  /** The mode each routable leg uses; a pair naming an unknown place has none. */
  modes: Map<string, RouteMode>;
  /** The legs the cache already has, in the right mode. */
  cached: Map<string, RouteLeg>;
}

/** Reads the pairs' places and whatever the `routes` cache holds for them. */
async function lookUp(pairs: PlacePair[], admin: AdminClient): Promise<Lookup> {
  const wanted = new Map<string, PlacePair>();
  for (const pair of pairs) if (pair.from !== pair.to) wanted.set(legKey(pair.from, pair.to), pair);
  const lookup: Lookup = { wanted, where: new Map(), modes: new Map(), cached: new Map() };
  if (wanted.size === 0) return lookup;

  const placeIds = [...new Set([...wanted.values()].flatMap((p) => [p.from, p.to]))];
  const { data: places, error: placeError } = await admin.from("places").select("id, lat, lng").in("id", placeIds);
  if (placeError) throw readFailed("places", placeError);
  for (const p of places) lookup.where.set(p.id, { lat: p.lat, lng: p.lng });
  for (const [key, pair] of wanted) {
    const from = lookup.where.get(pair.from);
    const to = lookup.where.get(pair.to);
    if (from && to) lookup.modes.set(key, routeModeFor(from, to));
  }

  const { data: rows, error: cacheError } = await admin
    .from("routes")
    .select("from_place_id, to_place_id, mode, geometry, duration_s, distance_m")
    .in("from_place_id", [...new Set([...wanted.values()].map((p) => p.from))])
    .in("to_place_id", [...new Set([...wanted.values()].map((p) => p.to))]);
  if (cacheError) throw readFailed("route cache", cacheError);
  for (const row of rows) {
    const key = legKey(row.from_place_id, row.to_place_id);
    if (lookup.modes.get(key) !== row.mode) continue;
    lookup.cached.set(key, {
      mode: row.mode as RouteMode,
      geometry: row.geometry as unknown as RouteLeg["geometry"],
      durationS: row.duration_s,
      distanceM: row.distance_m,
    });
  }
  return lookup;
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
  const { wanted, where, modes, cached } = await lookUp(pairs, admin);
  const legs = new Map(cached);
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

/**
 * Travel minutes (rounded up) for every pair, keyed `from:to`, for the optimizer's travel edges:
 * the cached route when there is one, otherwise a straight-line estimate at the mock's speeds.
 * A plan request can need ~60 legs, so this never calls the routing service or writes the cache;
 * `ensureRoutes` fetches real routes for the few legs the chosen plan uses. A same-place pair is 0.
 */
export async function travelMinutes(pairs: PlacePair[], deps: { admin?: AdminClient } = {}): Promise<Map<string, number>> {
  const { where, modes, cached } = await lookUp(pairs, deps.admin ?? getAdminClient());
  const estimate = createMockRoutingProvider();
  const minutes = new Map<string, number>();
  for (const pair of pairs) if (pair.from === pair.to) minutes.set(legKey(pair.from, pair.to), 0);
  for (const [key, mode] of modes) {
    const leg = cached.get(key);
    const [from, to] = key.split(":") as [string, string];
    const durationS = leg?.durationS ?? (await estimate.route({ from: where.get(from)!, to: where.get(to)!, mode })).durationS;
    minutes.set(key, minutesFor(durationS));
  }
  return minutes;
}
