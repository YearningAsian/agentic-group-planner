"use client";

import { useEffect, useRef, useState } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { FallbackMap } from "@/components/fallback-map";
import type { Destination } from "@/lib/data";

export function MapboxCanvas({
  token,
  focus,
  pinned,
}: {
  token: string;
  focus: Destination | null;
  pinned: boolean;
}) {
  const mapRef = useRef<MapRef>(null);
  const focusRef = useRef(focus);
  const pinnedRef = useRef(pinned);
  const [failed, setFailed] = useState(false);

  focusRef.current = focus;
  pinnedRef.current = pinned;

  function fly() {
    const map = mapRef.current;
    if (!map) return;
    const current = focusRef.current;
    if (!current) {
      map.flyTo({ center: [-30, 24], zoom: 1.25, duration: 900, essential: true });
      return;
    }
    map.flyTo({
      center: [current.lng, current.lat],
      zoom: pinnedRef.current ? 11 : 5.2,
      duration: 1400,
      essential: true,
    });
  }

  useEffect(() => {
    fly();
  }, [focus, pinned]);

  if (failed) {
    return (
      <FallbackMap
        focus={focus}
        pinned={pinned}
        note="Mapbox rejected this token. Showing the preview map instead."
      />
    );
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={token}
      initialViewState={{ longitude: -30, latitude: 24, zoom: 1.25 }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: "100%", height: "100%" }}
      onLoad={fly}
      onError={() => setFailed(true)}
      attributionControl
    >
      {pinned && focus ? (
        <Marker longitude={focus.lng} latitude={focus.lat} anchor="bottom">
          <div className="pin-pop flex flex-col items-center">
            <span className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow)]">
              {focus.label}
            </span>
            <span className="-mt-1 h-3 w-3 rotate-45 bg-accent" />
          </div>
        </Marker>
      ) : null}
    </Map>
  );
}
