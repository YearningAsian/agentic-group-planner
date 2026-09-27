"use client";

import { useEffect, useState } from "react";
import { SuggestField } from "@/features/trip-draft/components/suggest-field";
import { useDebouncedValue } from "@/features/trip-draft/use-debounced-value";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";

/** Cities only. If Duffel returned airports and no city, offer each airport's city name once. */
export function locationSuggestions(items: PlaceSuggestion[]): PlaceSuggestion[] {
  const cities = items.filter((item) => item.kind === "city");
  if (cities.length > 0) return cities;
  const seen = new Set<string>();
  const fromAirports: PlaceSuggestion[] = [];
  for (const item of items) {
    if (item.kind !== "airport") continue;
    const label = item.cityName?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fromAirports.push({ ...item, kind: "city", name: label });
  }
  return fromAirports;
}

export function DestinationSearch({
  value,
  onQueryChange,
  onSelect,
  debounceMs = 300,
  label = "Destination",
  placeholder = "City or place — try Lisbon",
  listId = "suggest-field-list",
}: {
  value: string;
  onQueryChange: (query: string) => void;
  onSelect: (place: PlaceSuggestion) => void;
  debounceMs?: number;
  label?: string;
  placeholder?: string;
  listId?: string;
}) {
  const [fetched, setFetched] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const [queryToken, setQueryToken] = useState("");
  const debounced = useDebouncedValue(value, debounceMs);
  const q = debounced.trim();
  const lookupActive = q.length >= 2 && pickedLabel !== q;
  if (q !== queryToken) {
    setQueryToken(q);
    setFetched([]);
    setLoading(lookupActive);
  }
  const suggestions = lookupActive ? locationSuggestions(fetched) : [];

  useEffect(() => {
    if (!lookupActive) return;
    const controller = new AbortController();
    fetch(`/api/place-suggestions?query=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup failed");
        const body = (await response.json()) as { suggestions?: PlaceSuggestion[] };
        setFetched(body.suggestions ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFetched([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [lookupActive, q]);

  return (
    <SuggestField
      label={label}
      listId={listId}
      value={value}
      onChange={(next) => {
        setPickedLabel(null);
        onQueryChange(next);
      }}
      suggestions={suggestions}
      loading={loading}
      onSelect={(item) => {
        setPickedLabel(item.name);
        setFetched([]);
        onSelect(item);
      }}
      placeholder={placeholder}
      getKey={(item) => `${item.kind}:${item.iataCode}`}
      getLabel={(item) => item.name}
    />
  );
}
