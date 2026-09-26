/**
 * Trip list for the studio. The copy in memory is pushed to `studio_state` for the signed-in user.
 */
import type { TripState } from "@/features/trip-draft/trip-context";
import { readStudio, writeStudioTrips } from "./studio-store";

export type TripRecord = TripState & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type TripsDatabase = {
  activeTripId: string | null;
  trips: TripRecord[];
};

export function loadDatabase(): TripsDatabase {
  const doc = readStudio();
  return { activeTripId: doc.activeTripId, trips: doc.trips as TripRecord[] };
}

export function saveDatabase(db: TripsDatabase): void {
  writeStudioTrips(db.activeTripId, db.trips);
}

export function upsertTripRecord(db: TripsDatabase, record: TripRecord): TripsDatabase {
  const existingIndex = db.trips.findIndex((t) => t.id === record.id);
  const nextTrips = [...db.trips];
  if (existingIndex >= 0) nextTrips[existingIndex] = record;
  else nextTrips.unshift(record);
  const nextDb: TripsDatabase = { activeTripId: record.id, trips: nextTrips };
  saveDatabase(nextDb);
  return nextDb;
}

export function deleteTripRecord(db: TripsDatabase, id: string): TripsDatabase {
  const nextTrips = db.trips.filter((t) => t.id !== id);
  const nextActiveId = db.activeTripId === id ? (nextTrips[0]?.id ?? null) : db.activeTripId;
  const nextDb: TripsDatabase = { activeTripId: nextActiveId, trips: nextTrips };
  saveDatabase(nextDb);
  return nextDb;
}
