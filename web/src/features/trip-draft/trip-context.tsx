"use client";

/**
 * Studio trip state. Trips are the shared board; the home address stays on this user.
 * Screen map: `app/(trip-draft)/layout.tsx`. Read and write only through `useTrip()`.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { DESTINATIONS, destinationById } from "@/features/trip-draft/fixtures";
import {
  loadDatabase,
  saveDatabase,
  upsertTripRecord,
  deleteTripRecord,
  type TripRecord,
  type TripsDatabase,
} from "@/features/trip-draft/trips-db";
import { pullStudio, resetStudioMemory, subscribeStudio } from "./studio-store";

export type Member = {
  id: string;
  name: string;
  joined: boolean;
  placeholder: boolean;
  flightId?: string | null;
  stayId?: string | null;
};

export type ConfirmedPlace = {
  label: string;
  iataCode: string;
  airportIatas: string[];
  lat: number | null;
  lng: number | null;
  fixtureId?: string | null;
};

export type TripState = {
  id?: string | null;
  destinationId: string | null;
  destinationQuery: string;
  destinationLabel?: string;
  destinationIata?: string | null;
  destinationAirportIatas?: string[];
  destinationLat?: number | null;
  destinationLng?: number | null;
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
    { id: "p1", name: "Person 1", joined: true, placeholder: false, flightId: null, stayId: null },
    { id: "p2", name: "Person 2", joined: false, placeholder: true, flightId: null, stayId: null },
    { id: "p3", name: "Person 3", joined: false, placeholder: true, flightId: null, stayId: null },
  ];
}

function initialState(): TripState {
  return {
    id: null,
    destinationId: null,
    destinationQuery: "",
    destinationLabel: "",
    destinationIata: null,
    destinationAirportIatas: [],
    destinationLat: null,
    destinationLng: null,
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
let stopLive: (() => void) | undefined;
const listeners = new Set<() => void>();

function matchFixture(place: Pick<ConfirmedPlace, "label" | "iataCode" | "airportIatas">) {
  return (
    DESTINATIONS.find((destination) => destination.code === place.iataCode) ??
    DESTINATIONS.find((destination) => place.airportIatas.includes(destination.code)) ??
    DESTINATIONS.find((destination) => destination.label.toLowerCase() === place.label.toLowerCase()) ??
    null
  );
}

function applyPlace(current: TripState, place: ConfirmedPlace): TripState {
  const fixture = place.fixtureId ? destinationById(place.fixtureId) : matchFixture(place);
  const samePlace = current.destinationIata === place.iataCode && current.destinationId === (fixture?.id ?? null);
  return {
    ...current,
    destinationId: fixture?.id ?? null,
    destinationQuery: place.label,
    destinationLabel: place.label,
    destinationIata: place.iataCode,
    destinationAirportIatas: place.airportIatas,
    destinationLat: place.lat,
    destinationLng: place.lng,
    pinDropped: true,
    lockedFlightId: samePlace ? current.lockedFlightId : null,
    lockedStayId: samePlace ? current.lockedStayId : null,
    members: samePlace ? current.members : clearMemberPicks(current.members),
    compareFlightIds: samePlace ? current.compareFlightIds : [],
    compareStayIds: samePlace ? current.compareStayIds : [],
  };
}

function normalizeState<T extends TripState>(state: T): T {
  const fixture = destinationById(state.destinationId);
  return {
    ...state,
    destinationLabel: state.destinationLabel ?? fixture?.label ?? "",
    destinationIata: state.destinationIata ?? fixture?.code ?? null,
    destinationAirportIatas: state.destinationAirportIatas ?? (fixture?.code ? [fixture.code] : []),
    destinationLat: state.destinationLat ?? fixture?.lat ?? null,
    destinationLng: state.destinationLng ?? fixture?.lng ?? null,
    members: state.members.map((member, index) => ({
      ...member,
      flightId: member.flightId ?? (index === 0 ? state.lockedFlightId : null),
      stayId: member.stayId ?? (index === 0 ? state.lockedStayId : null),
    })),
  };
}

function clearMemberPicks(members: Member[]): Member[] {
  return members.map((member) => ({ ...member, flightId: null, stayId: null }));
}

function applyLoaded() {
  dbSnapshot = loadDatabase();
  if (dbSnapshot.trips.length > 0) {
    const active = dbSnapshot.trips.find((t) => t.id === dbSnapshot.activeTripId) ?? dbSnapshot.trips[0];
    const normalizedTrips = dbSnapshot.trips.map(normalizeState);
    dbSnapshot = { ...dbSnapshot, trips: normalizedTrips };
    snapshot = normalizeState(active);
    dbSnapshot.activeTripId = active.id;
  } else {
    snapshot = initialState();
    dbSnapshot.activeTripId = null;
  }
}

function refreshFromServer() {
  applyLoaded();
  notify();
}

function hydrate() {
  if (didHydrate) return;
  didHydrate = true;
  applyLoaded();
  void pullStudio().then(refreshFromServer);
  stopLive = subscribeStudio(refreshFromServer);
}

/** Test hook: forgets the loaded document so the next render reads the memory store. */
export function resetTripContextForTests(): void {
  stopLive?.();
  stopLive = undefined;
  didHydrate = false;
  snapshot = initialState();
  dbSnapshot = { activeTripId: null, trips: [] };
  resetStudioMemory();
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
  confirmPlace: (place: ConfirmedPlace) => void;
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
  assignFlight: (memberId: string, id: string) => void;
  assignStay: (memberId: string, id: string) => void;
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
          const confirmedLabel = current.destinationLabel || destinationById(current.destinationId)?.label;
          const stillConfirmed = Boolean(
            confirmedLabel && query.trim().toLowerCase() === confirmedLabel.toLowerCase(),
          );
          return {
            ...current,
            destinationQuery: query,
            destinationId: stillConfirmed ? current.destinationId : null,
            destinationLabel: stillConfirmed ? current.destinationLabel : "",
            destinationIata: stillConfirmed ? current.destinationIata : null,
            destinationAirportIatas: stillConfirmed ? current.destinationAirportIatas : [],
            destinationLat: stillConfirmed ? current.destinationLat : null,
            destinationLng: stillConfirmed ? current.destinationLng : null,
            pinDropped: stillConfirmed ? current.pinDropped : false,
            lockedFlightId: stillConfirmed ? current.lockedFlightId : null,
            lockedStayId: stillConfirmed ? current.lockedStayId : null,
            members: stillConfirmed ? current.members : clearMemberPicks(current.members),
          };
        });
      },
      confirmDestination(id) {
        const destination = destinationById(id);
        if (!destination) return;
        commit((current) =>
          applyPlace(current, {
            fixtureId: destination.id,
            label: destination.label,
            iataCode: destination.code,
            airportIatas: [destination.code],
            lat: destination.lat,
            lng: destination.lng,
          }),
        );
        if (snapshot.id) {
          commitDraft();
        }
      },
      confirmPlace(place) {
        commit((current) => applyPlace(current, place));
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
                flightId: null,
                stayId: null,
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
      assignFlight(memberId, id) {
        commit((current) => ({
          ...current,
          members: current.members.map((member) => (member.id === memberId ? { ...member, flightId: id } : member)),
        }));
      },
      assignStay(memberId, id) {
        commit((current) => ({
          ...current,
          members: current.members.map((member) => (member.id === memberId ? { ...member, stayId: id } : member)),
        }));
      },
      lockFlight(id) {
        commit((current) => ({
          ...current,
          lockedFlightId: id,
          members: current.members.map((member, index) => (index === 0 ? { ...member, flightId: id } : member)),
          comparingFlights: false,
          compareFlightIds: [],
        }));
      },
      lockStay(id) {
        commit((current) => ({
          ...current,
          lockedStayId: id,
          members: current.members.map((member, index) => (index === 0 ? { ...member, stayId: id } : member)),
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
