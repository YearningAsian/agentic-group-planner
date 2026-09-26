"use client";

/**
 * Client-only trip state backed by localStorage database.
 * Screen map: `app/(trip-draft)/layout.tsx`. Read and write only through `useTrip()`.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { destinationById } from "@/features/trip-draft/fixtures";
import {
  loadDatabase,
  saveDatabase,
  upsertTripRecord,
  deleteTripRecord,
  type TripRecord,
  type TripsDatabase,
} from "@/features/trip-draft/trips-db";

export type Member = {
  id: string;
  name: string;
  joined: boolean;
  placeholder: boolean;
};

export type TripState = {
  id?: string | null;
  destinationId: string | null;
  destinationQuery: string;
  pinDropped: boolean;
  startDate: string;
  endDate: string;
  budget: number | null;
  dietary: string[];
  vibes: string[];
  members: Member[];
  lockedFlightId: string | null;
  lockedStayId: string | null;
  compareFlightIds: string[];
  compareStayIds: string[];
  comparingFlights: boolean;
  comparingStays: boolean;
  inviteShared: boolean;
  didSimulateJoin: boolean;
  justJoinedName: string | null;
};

export type { TripRecord, TripsDatabase };

function initialMembers(): Member[] {
  return [
    { id: "p1", name: "Person 1", joined: true, placeholder: false },
    { id: "p2", name: "Person 2", joined: false, placeholder: true },
    { id: "p3", name: "Person 3", joined: false, placeholder: true },
  ];
}

function initialState(): TripState {
  return {
    id: null,
    destinationId: null,
    destinationQuery: "",
    pinDropped: false,
    startDate: "",
    endDate: "",
    budget: null,
    dietary: [],
    vibes: [],
    members: initialMembers(),
    lockedFlightId: null,
    lockedStayId: null,
    compareFlightIds: [],
    compareStayIds: [],
    comparingFlights: false,
    comparingStays: false,
    inviteShared: false,
    didSimulateJoin: false,
    justJoinedName: null,
  };
}

const emptySnapshot = initialState();
const emptyTrips: TripRecord[] = [];
let dbSnapshot: TripsDatabase = { activeTripId: null, trips: [] };
let snapshot: TripState = emptySnapshot;
let didHydrate = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (didHydrate) return;
  didHydrate = true;
  dbSnapshot = loadDatabase();
  if (dbSnapshot.trips.length > 0) {
    const active =
      dbSnapshot.trips.find((t) => t.id === dbSnapshot.activeTripId) ?? dbSnapshot.trips[0];
    snapshot = active;
    dbSnapshot.activeTripId = active.id;
  } else {
    snapshot = initialState();
    dbSnapshot.activeTripId = null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(recipe: (current: TripState) => TripState) {
  const next = recipe(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  if (snapshot.id) {
    const now = Date.now();
    const existing = dbSnapshot.trips.find((t) => t.id === snapshot.id);
    const record: TripRecord = {
      ...snapshot,
      id: snapshot.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    dbSnapshot = upsertTripRecord(dbSnapshot, record);
  }
  notify();
}

function commitDraft(): string | null {
  if (!snapshot.destinationId && !snapshot.destinationQuery) return null;
  const now = Date.now();
  const id = snapshot.id ?? `trip-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const existing = dbSnapshot.trips.find((t) => t.id === id);
  const record: TripRecord = {
    ...snapshot,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  snapshot = record;
  dbSnapshot = upsertTripRecord(dbSnapshot, record);
  notify();
  return id;
}

function subscribeHydrated() {
  hydrate();
  return () => {};
}

type TripActions = {
  setDestinationQuery: (query: string) => void;
  confirmDestination: (id: string) => void;
  setDates: (start: string, end: string) => void;
  setBudget: (budget: number | null) => void;
  setDietary: (dietary: string[]) => void;
  toggleDietary: (value: string) => void;
  setVibes: (vibes: string[]) => void;
  toggleVibe: (value: string) => void;
  setMemberName: (id: string, name: string) => void;
  addMember: (placeholder: boolean) => void;
  removeMember: (id: string) => void;
  resetParty: () => void;
  lockFlight: (id: string) => void;
  lockStay: (id: string) => void;
  toggleCompareFlight: (id: string) => void;
  toggleCompareStay: (id: string) => void;
  setComparingFlights: (on: boolean) => void;
  setComparingStays: (on: boolean) => void;
  markInviteShared: () => void;
  markFirstPendingJoined: () => void;
  startNewTrip: () => void;
  commitDraft: () => string | null;
  selectTrip: (id: string) => void;
  deleteTrip: (id: string) => void;
};

type TripContextValue = {
  state: TripState;
  trips: TripRecord[];
  activeTripId: string | null;
  hasTrips: boolean;
} & TripActions;

export const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useSyncExternalStore(subscribeHydrated, () => true, () => false);
  const state = useSyncExternalStore(subscribe, () => snapshot, () => emptySnapshot);
  const trips = useSyncExternalStore(subscribe, () => dbSnapshot.trips, () => emptyTrips);
  const activeTripId = useSyncExternalStore(
    subscribe,
    () => dbSnapshot.activeTripId,
    () => null,
  );

  const actions = useMemo<TripActions>(
    () => ({
      setDestinationQuery(query) {
        commit((current) => {
          const destination = destinationById(current.destinationId);
          const stillConfirmed = Boolean(
            destination && query.trim().toLowerCase() === destination.label.toLowerCase(),
          );
          return {
            ...current,
            destinationQuery: query,
            destinationId: stillConfirmed ? current.destinationId : null,
            pinDropped: stillConfirmed ? current.pinDropped : false,
            lockedFlightId: stillConfirmed ? current.lockedFlightId : null,
            lockedStayId: stillConfirmed ? current.lockedStayId : null,
          };
        });
      },
      confirmDestination(id) {
        commit((current) => {
          const destination = destinationById(id);
          if (!destination) return current;
          const samePlace = current.destinationId === id;
          return {
            ...current,
            destinationId: id,
            destinationQuery: destination.label,
            pinDropped: true,
            lockedFlightId: samePlace ? current.lockedFlightId : null,
            lockedStayId: samePlace ? current.lockedStayId : null,
            compareFlightIds: samePlace ? current.compareFlightIds : [],
            compareStayIds: samePlace ? current.compareStayIds : [],
          };
        });
        if (snapshot.id) {
          commitDraft();
        }
      },
      setDates(start, end) {
        commit((current) => ({ ...current, startDate: start, endDate: end }));
      },
      setBudget(budget) {
        commit((current) => ({ ...current, budget }));
      },
      setDietary(dietary) {
        commit((current) => ({ ...current, dietary }));
      },
      toggleDietary(value) {
        commit((current) => {
          if (value === "None") {
            return { ...current, dietary: current.dietary.includes("None") ? [] : ["None"] };
          }
          const without = current.dietary.filter((item) => item !== "None" && item !== value);
          const dietary = current.dietary.includes(value) ? without : [...without, value];
          return { ...current, dietary };
        });
      },
      setVibes(vibes) {
        commit((current) => ({ ...current, vibes }));
      },
      toggleVibe(value) {
        commit((current) => {
          const vibes = current.vibes.includes(value)
            ? current.vibes.filter((item) => item !== value)
            : [...current.vibes, value];
          return { ...current, vibes };
        });
      },
      setMemberName(id, name) {
        commit((current) => ({
          ...current,
          members: current.members.map((member) => (member.id === id ? { ...member, name } : member)),
        }));
      },
      addMember(placeholder) {
        commit((current) => {
          if (current.members.length >= 6) return current;
          const count = current.members.length + 1;
          return {
            ...current,
            members: [
              ...current.members,
              {
                id: `p${count}-${Date.now()}`,
                name: placeholder ? "" : `Person ${count}`,
                joined: false,
                placeholder,
              },
            ],
          };
        });
      },
      removeMember(id) {
        commit((current) => {
          if (id === current.members[0]?.id) return current;
          return { ...current, members: current.members.filter((member) => member.id !== id) };
        });
      },
      resetParty() {
        commit((current) => ({ ...current, members: initialMembers() }));
      },
      lockFlight(id) {
        commit((current) => ({
          ...current,
          lockedFlightId: id,
          comparingFlights: false,
          compareFlightIds: [],
        }));
      },
      lockStay(id) {
        commit((current) => ({
          ...current,
          lockedStayId: id,
          comparingStays: false,
          compareStayIds: [],
        }));
      },
      toggleCompareFlight(id) {
        commit((current) => {
          const has = current.compareFlightIds.includes(id);
          return {
            ...current,
            compareFlightIds: has
              ? current.compareFlightIds.filter((item) => item !== id)
              : [...current.compareFlightIds, id].slice(0, 3),
          };
        });
      },
      toggleCompareStay(id) {
        commit((current) => {
          const has = current.compareStayIds.includes(id);
          return {
            ...current,
            compareStayIds: has
              ? current.compareStayIds.filter((item) => item !== id)
              : [...current.compareStayIds, id].slice(0, 3),
          };
        });
      },
      setComparingFlights(on) {
        commit((current) => ({
          ...current,
          comparingFlights: on,
          compareFlightIds: on ? current.compareFlightIds : [],
        }));
      },
      setComparingStays(on) {
        commit((current) => ({
          ...current,
          comparingStays: on,
          compareStayIds: on ? current.compareStayIds : [],
        }));
      },
      markInviteShared() {
        commit((current) => ({ ...current, inviteShared: true }));
      },
      markFirstPendingJoined() {
        commit((current) => {
          if (current.didSimulateJoin) return current;
          const index = current.members.findIndex((member) => !member.joined);
          if (index < 0) return { ...current, didSimulateJoin: true };
          const member = current.members[index];
          const name = member.name.trim() || "Person 2";
          const members = current.members.map((item, itemIndex) =>
            itemIndex === index ? { ...item, name, joined: true, placeholder: false } : item,
          );
          return { ...current, members, didSimulateJoin: true, justJoinedName: name };
        });
      },
      startNewTrip() {
        snapshot = initialState();
        dbSnapshot = { ...dbSnapshot, activeTripId: null };
        saveDatabase(dbSnapshot);
        notify();
      },
      commitDraft() {
        return commitDraft();
      },
      selectTrip(id) {
        const found = dbSnapshot.trips.find((t) => t.id === id);
        if (found) {
          snapshot = found;
          dbSnapshot = { ...dbSnapshot, activeTripId: id };
          saveDatabase(dbSnapshot);
          notify();
        }
      },
      deleteTrip(id) {
        dbSnapshot = deleteTripRecord(dbSnapshot, id);
        if (snapshot.id === id) {
          const nextActive = dbSnapshot.trips[0] ?? initialState();
          snapshot = nextActive;
        }
        notify();
      },
    }),
    [],
  );

  const value = useMemo(
    () => ({
      state,
      trips,
      activeTripId,
      hasTrips: trips.length > 0,
      ...actions,
    }),
    [state, trips, activeTripId, actions],
  );

  return (
    <TripContext.Provider value={value}>
      {hydrated ? (
        children
      ) : (
        <div className="min-h-dvh bg-surface" role="status">
          <span className="sr-only">Loading your trip</span>
        </div>
      )}
    </TripContext.Provider>
  );
}

export function useTrip(): TripContextValue {
  const value = useContext(TripContext);
  if (!value) throw new Error("useTrip must be used within TripProvider");
  return value;
}
