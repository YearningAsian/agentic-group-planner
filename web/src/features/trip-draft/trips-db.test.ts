// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  TRIPS_DB_KEY,
  deleteTripRecord,
  loadDatabase,
  saveDatabase,
  upsertTripRecord,
  type TripRecord,
} from "./trips-db";
import { inProgressCard, tripListCards, PAST_TRIPS } from "./dashboard-data";
import type { TripState } from "./trip-context";

function dummyState(overrides: Partial<TripState> = {}): TripState {
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
    members: [{ id: "p1", name: "Person 1", joined: true, placeholder: false }],
    lockedFlightId: null,
    lockedStayId: null,
    compareFlightIds: [],
    compareStayIds: [],
    comparingFlights: false,
    comparingStays: false,
    inviteShared: false,
    didSimulateJoin: false,
    justJoinedName: null,
    ...overrides,
  };
}

describe("trips-db", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads empty database by default without demo trips", () => {
    const db = loadDatabase();
    expect(db.trips).toEqual([]);
    expect(db.activeTripId).toBeNull();
  });

  it("saves and loads trips from localStorage", () => {
    const record: TripRecord = {
      ...dummyState({ destinationId: "lisbon", destinationQuery: "Lisbon" }),
      id: "trip-1",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const db = upsertTripRecord({ activeTripId: null, trips: [] }, record);
    expect(db.activeTripId).toBe("trip-1");
    expect(db.trips).toHaveLength(1);

    const loaded = loadDatabase();
    expect(loaded.trips).toHaveLength(1);
    expect(loaded.trips[0].id).toBe("trip-1");
  });

  it("updates existing trip record without duplicating", () => {
    const record1: TripRecord = {
      ...dummyState({ destinationId: "lisbon", destinationQuery: "Lisbon" }),
      id: "trip-1",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const db1 = upsertTripRecord({ activeTripId: null, trips: [] }, record1);
    const record2: TripRecord = {
      ...record1,
      budget: 1500,
      updatedAt: 2000,
    };
    const db2 = upsertTripRecord(db1, record2);
    expect(db2.trips).toHaveLength(1);
    expect(db2.trips[0].budget).toBe(1500);
  });

  it("deletes trip record and shifts activeTripId", () => {
    const record1: TripRecord = {
      ...dummyState({ destinationId: "lisbon" }),
      id: "trip-1",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const record2: TripRecord = {
      ...dummyState({ destinationId: "tokyo" }),
      id: "trip-2",
      createdAt: 1001,
      updatedAt: 1001,
    };
    let db = upsertTripRecord({ activeTripId: null, trips: [] }, record1);
    db = upsertTripRecord(db, record2);
    expect(db.trips).toHaveLength(2);

    const afterDelete = deleteTripRecord(db, "trip-2");
    expect(afterDelete.trips).toHaveLength(1);
    expect(afterDelete.trips[0].id).toBe("trip-1");
    expect(afterDelete.activeTripId).toBe("trip-1");
  });
});

describe("dashboard-data (demo removal)", () => {
  it("has no hardcoded past demo trips", () => {
    expect(PAST_TRIPS).toEqual([]);
  });

  it("returns null for inProgressCard when state has no destination", () => {
    const card = inProgressCard(dummyState());
    expect(card).toBeNull();
  });

  it("returns empty array for tripListCards when there are no trips", () => {
    const cards = tripListCards(dummyState(), []);
    expect(cards).toEqual([]);
  });

  it("formats user trip into tripListCard properly", () => {
    const record: TripRecord = {
      ...dummyState({
        destinationId: "lisbon",
        startDate: "2026-10-01",
        endDate: "2026-10-05",
      }),
      id: "trip-test",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const cards = tripListCards(record, [record]);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("trip-test");
    expect(cards[0].place).toContain("Lisbon");
  });
});
