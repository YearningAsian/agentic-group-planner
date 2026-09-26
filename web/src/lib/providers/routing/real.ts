import "server-only";
import type { RouteMode } from "@agp/shared";
import { z } from "zod";
import { AppError, withPolicy } from "@/lib/reliability";
import { minutesFor } from "./distance";
import type { LatLng, RoutingProvider } from "./types";

/** Design §7.4: OpenRouteService gets 5 s per attempt and one retry. */
const ORS_TIMEOUT_MS = 5_000;
const ORS_RETRIES = 1;
const ORS_BASE_URL = "https://api.openrouteservice.org";

const PROFILE: Record<RouteMode, string> = { walking: "foot-walking", driving: "driving-car" };

const Position = z.tuple([z.number(), z.number()]).rest(z.number());

/** The parts of a v2 `/directions/{profile}/geojson` answer we read. ORS omits zero summaries. */
const DirectionsResponse = z.object({
  features: z
    .array(
      z.object({
        properties: z.object({
          summary: z.object({ distance: z.number().min(0).default(0), duration: z.number().min(0).default(0) }),
        }),
        geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(Position).min(2) }),
      }),
    )
    .min(1),
});

/** A v2 `/matrix/{profile}` answer; an unroutable pair comes back as null. */
const MatrixResponse = z.object({ durations: z.array(z.array(z.number().min(0).nullable())) });

/** A non-2xx answer. `withPolicy` retries it when the status is 429 or 5xx. */
class OrsHttpError extends Error {
  override readonly name = "OrsHttpError";

  constructor(readonly status: number) {
    super(`OpenRouteService answered ${status}.`);
  }
}

export interface OrsRoutingOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Backoff before the retry; tests shorten it. */
  backoffMs?: number;
}

const lngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

/**
 * OpenRouteService directions and matrix (design §2.3), each call wrapped in `withPolicy`.
 * Directions come back as GeoJSON, so the geometry is stored as ORS draws it.
 */
export function createOrsRoutingProvider(options: OrsRoutingOptions): RoutingProvider {
  const fetch = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? ORS_BASE_URL).replace(/\/+$/, "");

  /** POSTs to a path relative to the base URL, like `v2/matrix/foot-walking`. */
  async function post(path: string, body: unknown): Promise<unknown> {
    try {
      return await withPolicy(
        async (signal) => {
          const response = await fetch(`${base}/${path}`, {
            method: "POST",
            headers: { authorization: options.apiKey, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal,
          });
          if (!response.ok) throw new OrsHttpError(response.status);
          return response.json();
        },
        { timeoutMs: ORS_TIMEOUT_MS, retries: ORS_RETRIES, backoffMs: options.backoffMs },
      );
    } catch (error) {
      // A 4xx means the key or the points are wrong (ORS answers 404 for an unroutable leg); retrying won't help.
      if (error instanceof OrsHttpError) {
        throw new AppError("internal", "The routing service couldn't route this leg.", { retryable: false, cause: error });
      }
      throw error;
    }
  }

  function unreadable(cause: unknown): AppError {
    return new AppError("internal", "The routing service sent an answer we can't read.", { retryable: false, cause });
  }

  return {
    name: "ors",
    async route({ from, to, mode }) {
      const parsed = DirectionsResponse.safeParse(
        await post(`v2/directions/${PROFILE[mode]}/geojson`, { coordinates: [lngLat(from), lngLat(to)] }),
      );
      if (!parsed.success) throw unreadable(parsed.error);
      const [feature] = parsed.data.features;
      return {
        // Drop any elevation, so the stored line is plain [lng, lat].
        geometry: { type: "LineString", coordinates: feature!.geometry.coordinates.map(([lng, lat]) => [lng, lat]) },
        durationS: Math.round(feature!.properties.summary.duration),
        distanceM: Math.round(feature!.properties.summary.distance),
      };
    },
    async matrix({ points, mode }) {
      const parsed = MatrixResponse.safeParse(
        await post(`v2/matrix/${PROFILE[mode]}`, { locations: points.map(lngLat), metrics: ["duration"] }),
      );
      if (!parsed.success) throw unreadable(parsed.error);
      return parsed.data.durations.map((row) =>
        row.map((seconds) => {
          if (seconds === null) throw new AppError("internal", "The routing service found no route between two stops.", { retryable: false });
          return minutesFor(seconds);
        }),
      );
    },
  };
}
