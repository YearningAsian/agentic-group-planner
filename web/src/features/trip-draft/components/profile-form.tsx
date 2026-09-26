"use client";

import { useEffect, useState } from "react";
import { SuggestField } from "@/features/trip-draft/components/suggest-field";
import { PrimaryButton } from "@/features/trip-draft/components/chrome";
import { loadProfile, saveProfile, type LocalProfile } from "@/features/trip-draft/profile-db";
import { useDebouncedValue } from "@/features/trip-draft/use-debounced-value";
import type { GeocodeSuggestion } from "@/lib/providers/geocoding/types";

export function ProfileForm({ debounceMs = 300 }: { debounceMs?: number }) {
  const [profile, setProfile] = useState<LocalProfile>(() => loadProfile());
  const [query, setQuery] = useState(profile.homeAddress);
  const [picked, setPicked] = useState<GeocodeSuggestion | null>(
    profile.homeLat != null && profile.homeLng != null
      ? { label: profile.homeAddress, lat: profile.homeLat, lng: profile.homeLng }
      : null,
  );
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const debounced = useDebouncedValue(query, debounceMs);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2 || picked?.label === q) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/geocode?query=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup failed");
        const body = (await response.json()) as { suggestions?: GeocodeSuggestion[] };
        setSuggestions(body.suggestions ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setSuggestions([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced, picked?.label]);

  function select(item: GeocodeSuggestion) {
    setQuery(item.label);
    setPicked(item);
    setSuggestions([]);
    setSaved(false);
    setError("");
  }

  function save() {
    if (!picked) {
      setError("Pick an address from the list.");
      return;
    }
    const next = { homeAddress: picked.label, homeLat: picked.lat, homeLng: picked.lng };
    saveProfile(next);
    setProfile(next);
    setSaved(true);
    setError("");
  }

  return (
    <form
      className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8 sm:px-8"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div>
        <p className="text-[13px] font-semibold text-muted">Profile</p>
        <h1 className="font-display mt-2 text-[2rem] leading-tight font-medium tracking-[-0.03em]">Home address</h1>
        <p className="mt-2 text-[14px] text-muted">
          Used as the default origin for later flight searches. Pick a suggestion so we store the
          coordinates, not just the text.
        </p>
      </div>
      <SuggestField
        label="Home address"
        value={query}
        onChange={(next) => {
          setQuery(next);
          setPicked(null);
          setSaved(false);
        }}
        suggestions={suggestions}
        loading={loading}
        onSelect={select}
        placeholder="Start typing a street address…"
        getKey={(item) => `${item.label}:${item.lat}:${item.lng}`}
        getLabel={(item) => item.label}
      />
      {profile.homeAddress && picked?.label === profile.homeAddress ? (
        <p className="text-[14px] text-ink">Saved · {profile.homeAddress}</p>
      ) : null}
      {error ? (
        <p className="text-[14px] font-medium text-accent" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-[14px] text-ink">Home address saved.</p> : null}
      <PrimaryButton type="submit" disabled={!picked} className="w-fit min-w-36">
        Save address
      </PrimaryButton>
    </form>
  );
}
