"use client";

/**
 * Only map component draft screens should import.
 * Live Mapbox when `isLiveMapboxToken` (`format.ts`) accepts `NEXT_PUBLIC_MAPBOX_TOKEN`; otherwise `MapLibreCanvas`.
 * Tile failure inside either canvas renders `FallbackMap`. `MapMarker` is declared in `fallback-map.tsx`.
 */
import dynamic from "next/dynamic";
import { type MapMarker } from "@/features/trip-draft/components/fallback-map";
import type { Destination } from "@/features/trip-draft/fixtures";
import { isLiveMapboxToken } from "@/features/trip-draft/format";

const MapboxCanvas = dynamic(
  () => import("@/features/trip-draft/components/mapbox-canvas").then((mod) => mod.MapboxCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[220px] bg-[#e7eef2]" />,
  },
);

const MapLibreCanvas = dynamic(
  () => import("@/features/trip-draft/components/maplibre-canvas").then((mod) => mod.MapLibreCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[220px] bg-[#e7eef2]" />,
  },
);

export function TripMap({
  focus,
  pinned,
  markers,
  onSelectMarker,
}: {
  focus: Destination | null;
  pinned: boolean;
  markers?: MapMarker[];
  onSelectMarker?: (id: string) => void;
}) {
  // A real Mapbox token wins. Otherwise OpenFreeMap draws live streets. The cartoon map is only if tiles fail.
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (isLiveMapboxToken(token)) {
    return (
      <MapboxCanvas
        token={token}
        focus={focus}
        pinned={pinned}
        markers={markers}
        onSelectMarker={onSelectMarker}
      />
    );
  }
  return <MapLibreCanvas focus={focus} pinned={pinned} markers={markers} onSelectMarker={onSelectMarker} />;
}
