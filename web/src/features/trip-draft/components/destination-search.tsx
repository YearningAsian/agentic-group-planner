"use client";

import { useEffect, useState } from "react";
import { SuggestField } from "@/features/trip-draft/components/suggest-field";
import { useDebouncedValue } from "@/features/trip-draft/use-debounced-value";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";

export function DestinationSearch({
  value,
  onQueryChange,
  onSelect,
  debounceMs = 300,
}: {
  value: string;
  onQueryChange: (query: string) => void;
  onSelect: (place: PlaceSuggestion) => void;
  debounceMs?: number;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const debounced = useDebouncedValue(value, debounceMs);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2 || pickedLabel === q) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/place-suggestions?query=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup failed");
        const body = (await response.json()) as { suggestions?: PlaceSuggestion[] };
        setSuggestions(body.suggestions ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setSuggestions([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced, pickedLabel]);

  return (
    <SuggestField
      label="Destination"
      value={value}
      onChange={(next) => {
        setPickedLabel(null);
        onQueryChange(next);
      }}
      suggestions={suggestions}
      loading={loading}
      onSelect={(item) => {
        setPickedLabel(item.name);
        setSuggestions([]);
        onSelect(item);
      }}
      placeholder="City or airport — try Lisbon or LHR"
      getKey={(item) => `${item.kind}:${item.iataCode}`}
      getLabel={(item) => `${item.name} (${item.iataCode})`}
      getHint={(item) =>
        item.kind === "city" && item.airports.length > 1
          ? item.airports.map((airport) => airport.iataCode).join(" · ")
          : item.kind === "airport"
            ? "Airport"
            : undefined
      }
    />
  );
}
