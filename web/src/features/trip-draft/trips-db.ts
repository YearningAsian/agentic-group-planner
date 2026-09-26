/**
 * Local storage database for trips.
 * Provides client-side persistence for user-created trips in localStorage.
 */
import type { TripState } from "@/features/trip-draft/trip-context";

export type TripRecord = TripState & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type TripsDatabase = {
  activeTripId: string | null;
  trips: TripRecord[];
};

export const TRIPS_DB_KEY = "agp-trips-db";

export function loadDatabase(): TripsDatabase {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return { activeTripId: null, trips: [] };
  }
  try {
    const raw = localStorage.getItem(TRIPS_DB_KEY);
    if (!raw) return { activeTripId: null, trips: [] };
    const parsed = JSON.parse(raw);
    const trips = Array.isArray(parsed?.trips) ? (parsed.trips as TripRecord[]) : [];
    const activeTripId = typeof parsed?.activeTripId === "string" ? parsed.activeTripId : null;
    return { activeTripId, trips };
  } catch {
    return { activeTripId: null, trips: [] };
  }
}

export function saveDatabase(db: TripsDatabase): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TRIPS_DB_KEY, JSON.stringify(db));
  } catch {
    // Storage quota or blocked in private mode
  }
}

export function upsertTripRecord(db: TripsDatabase, record: TripRecord): TripsDatabase {
  const existingIndex = db.trips.findIndex((t) => t.id === record.id);
  const nextTrips = [...db.trips];
  if (existingIndex >= 0) {
    nextTrips[existingIndex] = record;
  } else {
    nextTrips.unshift(record);
  }
  const nextDb: TripsDatabase = {
    activeTripId: record.id,
    trips: nextTrips,
  };
  saveDatabase(nextDb);
  return nextDb;
}

export function deleteTripRecord(db: TripsDatabase, id: string): TripsDatabase {
  const nextTrips = db.trips.filter((t) => t.id !== id);
  const nextActiveId = db.activeTripId === id ? (nextTrips[0]?.id ?? null) : db.activeTripId;
  const nextDb: TripsDatabase = {
    activeTripId: nextActiveId,
    trips: nextTrips,
  };
  saveDatabase(nextDb);
  return nextDb;
}
