"use client";

/**
 * Live streets when no Mapbox token is set. Mounted only by `trip-map.tsx`. OpenFreeMap tiles, same pins as MapboxCanvas.
 * A style-load failure falls back to `FallbackMap`.
 */
import { useEffect, useRef, useState } from "react";
import Map, { Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { FallbackMap, type MapMarker } from "@/features/trip-draft/components/fallback-map";
import type { Destination } from "@/features/trip-draft/fixtures";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function MapLibreCanvas({
  focus,
  pinned,
  markers = [],
  onSelectMarker,
}: {
  focus: Destination | null;
  pinned: boolean;
  markers?: MapMarker[];
  onSelectMarker?: (id: string) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const focusRef = useRef(focus);
  const pinnedRef = useRef(pinned);
  const markerZoomRef = useRef(markers.length > 0);
  const loadedRef = useRef(false);
  const [failed, setFailed] = useState(false);

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
      zoom: markerZoomRef.current ? 12.4 : pinnedRef.current ? 11 : 5.2,
      duration: 1400,
      essential: true,
    });
  }

  useEffect(() => {
    focusRef.current = focus;
    pinnedRef.current = pinned;
    markerZoomRef.current = markers.length > 0;
    fly();
  }, [focus, pinned, markers.length]);

  if (failed) {
    return (
      <FallbackMap
        focus={focus}
        pinned={pinned}
        markers={markers}
        onSelectMarker={onSelectMarker}
        note="Live tiles didn't load. Showing the preview map instead."
      />
    );
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: focus?.lng ?? -30, latitude: focus?.lat ?? 24, zoom: markers.length ? 12 : 1.25 }}
      mapStyle={STYLE}
      style={{ width: "100%", height: "100%" }}
      onLoad={() => {
        loadedRef.current = true;
        fly();
      }}
      onError={() => {
        if (!loadedRef.current) setFailed(true);
      }}
      attributionControl={{}}
    >
      {markers.map((marker) => (
        <Marker key={marker.id} longitude={marker.lng} latitude={marker.lat} anchor="bottom">
          <button
            type="button"
            onClick={() => onSelectMarker?.(marker.id)}
            className={
              marker.selected
                ? "pin-pop flex items-center gap-1.5 rounded-[11px] border border-accent bg-white py-1 pr-2.5 pl-1 shadow-[var(--shadow)]"
                : "flex items-center gap-1.5 rounded-[11px] border border-line bg-white py-1 pr-2.5 pl-1 shadow-[var(--shadow)]"
            }
          >
            <span className={marker.selected ? "size-2.5 rounded-full bg-accent" : "size-2.5 rounded-full bg-ink"} />
            <span className="text-[12px] font-bold whitespace-nowrap text-ink">{marker.label}</span>
          </button>
        </Marker>
      ))}
      {markers.length > 0 ? <NavigationControl position="bottom-right" showCompass={false} /> : null}
      {markers.length === 0 && pinned && focus ? (
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
