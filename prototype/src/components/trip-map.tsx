"use client";

import dynamic from "next/dynamic";
import { FallbackMap } from "@/components/fallback-map";
import type { Destination } from "@/lib/data";
import { isLiveMapboxToken } from "@/lib/format";

const MapboxCanvas = dynamic(
  () => import("@/components/mapbox-canvas").then((mod) => mod.MapboxCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[220px] bg-[#c5d5d0]" />,
  },
);

export function TripMap({ focus, pinned }: { focus: Destination | null; pinned: boolean }) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!isLiveMapboxToken(token)) {
    return <FallbackMap focus={focus} pinned={pinned} />;
  }
  return <MapboxCanvas token={token} focus={focus} pinned={pinned} />;
}
