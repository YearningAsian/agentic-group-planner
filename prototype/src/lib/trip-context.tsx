"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { destinationById } from "@/lib/data";

export type Member = {
  id: string;
  name: string;
  joined: boolean;
  placeholder: boolean;
};

export type TripState = {
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

const STORAGE_KEY = "group-trip-agent-prototype";

function initialMembers(): Member[] {
  return [
    { id: "p1", name: "Person 1", joined: true, placeholder: false },
    { id: "p2", name: "Person 2", joined: false, placeholder: true },
    { id: "p3", name: "Person 3", joined: false, placeholder: true },
  ];
}

function initialState(): TripState {
  return {
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

function loadState(): TripState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<TripState>;
    const base = initialState();
    return {
      ...base,
      ...parsed,
      members: Array.isArray(parsed.members) && parsed.members.length > 0 ? parsed.members : base.members,
      dietary: Array.isArray(parsed.dietary) ? parsed.dietary : [],
      vibes: Array.isArray(parsed.vibes) ? parsed.vibes : [],
      compareFlightIds: Array.isArray(parsed.compareFlightIds) ? parsed.compareFlightIds : [],
      compareStayIds: Array.isArray(parsed.compareStayIds) ? parsed.compareStayIds : [],
    };
  } catch {
    return initialState();
  }
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
};

type TripContextValue = { state: TripState } & TripActions;

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TripState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const actions = useMemo<TripActions>(
    () => ({
      setDestinationQuery(query) {
        setState((current) => {
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
        setState((current) => {
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
      },
      setDates(start, end) {
        setState((current) => ({ ...current, startDate: start, endDate: end }));
      },
      setBudget(budget) {
        setState((current) => ({ ...current, budget }));
      },
      setDietary(dietary) {
        setState((current) => ({ ...current, dietary }));
      },
      toggleDietary(value) {
        setState((current) => {
          if (value === "None") {
            return { ...current, dietary: current.dietary.includes("None") ? [] : ["None"] };
          }
          const without = current.dietary.filter((item) => item !== "None" && item !== value);
          const dietary = current.dietary.includes(value) ? without : [...without, value];
          return { ...current, dietary };
        });
      },
      setVibes(vibes) {
        setState((current) => ({ ...current, vibes }));
      },
      toggleVibe(value) {
        setState((current) => {
          const vibes = current.vibes.includes(value)
            ? current.vibes.filter((item) => item !== value)
            : [...current.vibes, value];
          return { ...current, vibes };
        });
      },
      setMemberName(id, name) {
        setState((current) => ({
          ...current,
          members: current.members.map((member) => (member.id === id ? { ...member, name } : member)),
        }));
      },
      addMember(placeholder) {
        setState((current) => {
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
        setState((current) => {
          if (id === current.members[0]?.id) return current;
          return { ...current, members: current.members.filter((member) => member.id !== id) };
        });
      },
      resetParty() {
        setState((current) => ({ ...current, members: initialMembers() }));
      },
      lockFlight(id) {
        setState((current) => ({
          ...current,
          lockedFlightId: id,
          comparingFlights: false,
          compareFlightIds: [],
        }));
      },
      lockStay(id) {
        setState((current) => ({
          ...current,
          lockedStayId: id,
          comparingStays: false,
          compareStayIds: [],
        }));
      },
      toggleCompareFlight(id) {
        setState((current) => {
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
        setState((current) => {
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
        setState((current) => ({
          ...current,
          comparingFlights: on,
          compareFlightIds: on ? current.compareFlightIds : [],
        }));
      },
      setComparingStays(on) {
        setState((current) => ({
          ...current,
          comparingStays: on,
          compareStayIds: on ? current.compareStayIds : [],
        }));
      },
      markInviteShared() {
        setState((current) => ({ ...current, inviteShared: true }));
      },
      markFirstPendingJoined() {
        setState((current) => {
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
    }),
    [],
  );

  const value = useMemo(() => ({ state, ...actions }), [state, actions]);

  return (
    <TripContext.Provider value={value}>
      {hydrated ? (
        children
      ) : (
        <div className="min-h-dvh bg-white" role="status">
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
