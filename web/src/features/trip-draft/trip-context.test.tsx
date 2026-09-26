// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRIPS_DB_KEY, type TripRecord } from "./trips-db";
import { TripProvider, useTrip, type TripState } from "./trip-context";

type TripApi = ReturnType<typeof useTrip>;

let api: TripApi | null = null;

function Probe() {
  const value = useTrip();
  useEffect(() => {
    api = value;
  });
  const organizer = value.state.members[0];
  return (
    <div>
      <span data-testid="organizer-flight">{organizer?.flightId ?? "none"}</span>
      <span data-testid="organizer-stay">{organizer?.stayId ?? "none"}</span>
      <span data-testid="destination">{value.state.destinationId ?? "none"}</span>
      <span data-testid="destination-iata">{value.state.destinationIata ?? "none"}</span>
      <span data-testid="destination-airports">{(value.state.destinationAirportIatas ?? []).join(",") || "none"}</span>
      <span data-testid="destination-label">{value.state.destinationLabel || "none"}</span>
    </div>
  );
}

function renderProvider(): TripApi {
  api = null;
  render(
    <TripProvider>
      <Probe />
    </TripProvider>,
  );
  if (!api) throw new Error("TripProvider did not expose context");
  return api;
}

function legacyRecord(overrides: Partial<Omit<TripState, "id">> = {}): TripRecord {
  return {
    id: "trip-legacy",
    destinationId: "lisbon",
    destinationQuery: "Lisbon",
    pinDropped: true,
    startDate: "",
    endDate: "",
    budget: null,
    dietary: [],
    vibes: [],
    members: [{ id: "p1", name: "Person 1", joined: true, placeholder: false }],
    lockedFlightId: "lisbon-flight-1",
    lockedStayId: "lisbon-stay-1",
    compareFlightIds: [],
    compareStayIds: [],
    comparingFlights: false,
    comparingStays: false,
    inviteShared: false,
    didSimulateJoin: false,
    justJoinedName: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("TripProvider member picks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (api) {
      act(() => api?.startNewTrip());
    }
    api = null;
  });

  it("keeps legacy locked picks visible as the organizer choices", () => {
    localStorage.setItem(
      TRIPS_DB_KEY,
      JSON.stringify({ activeTripId: "trip-legacy", trips: [legacyRecord()] }),
    );

    renderProvider();

    expect(screen.getByTestId("organizer-flight")).toHaveTextContent("lisbon-flight-1");
    expect(screen.getByTestId("organizer-stay")).toHaveTextContent("lisbon-stay-1");
    expect(screen.getByTestId("destination-iata")).toHaveTextContent("LIS");
    expect(screen.getByTestId("destination-label")).toHaveTextContent("Lisbon");
  });

  it("assigns a flight and stay to one member", () => {
    const trip = renderProvider();

    act(() => {
      trip.assignFlight("p1", "lisbon-flight-2");
      trip.assignStay("p1", "lisbon-stay-2");
    });

    expect(screen.getByTestId("organizer-flight")).toHaveTextContent("lisbon-flight-2");
    expect(screen.getByTestId("organizer-stay")).toHaveTextContent("lisbon-stay-2");
  });

  it("clears member picks when the destination changes", () => {
    const trip = renderProvider();

    act(() => {
      trip.confirmDestination("lisbon");
      trip.assignFlight("p1", "lisbon-flight-2");
      trip.assignStay("p1", "lisbon-stay-2");
      trip.confirmDestination("kyoto");
    });

    expect(screen.getByTestId("destination")).toHaveTextContent("kyoto");
    expect(screen.getByTestId("organizer-flight")).toHaveTextContent("none");
    expect(screen.getByTestId("organizer-stay")).toHaveTextContent("none");
  });

  it("stores the display name and IATA codes when a Duffel place is confirmed", () => {
    const trip = renderProvider();

    act(() => {
      trip.confirmPlace({
        label: "London",
        iataCode: "LON",
        airportIatas: ["LHR", "LGW", "STN"],
        lat: 51.5074,
        lng: -0.1278,
      });
    });

    expect(screen.getByTestId("destination-label")).toHaveTextContent("London");
    expect(screen.getByTestId("destination-iata")).toHaveTextContent("LON");
    expect(screen.getByTestId("destination-airports")).toHaveTextContent("LHR,LGW,STN");
    expect(screen.getByTestId("destination")).toHaveTextContent("none");
  });

  it("stamps fixture IATA codes when a known city is confirmed", () => {
    const trip = renderProvider();

    act(() => {
      trip.confirmDestination("lisbon");
    });

    expect(screen.getByTestId("destination")).toHaveTextContent("lisbon");
    expect(screen.getByTestId("destination-label")).toHaveTextContent("Lisbon");
    expect(screen.getByTestId("destination-iata")).toHaveTextContent("LIS");
    expect(screen.getByTestId("destination-airports")).toHaveTextContent("LIS");
  });

  it("clears IATA fields when the destination query no longer matches the confirmed label", () => {
    const trip = renderProvider();

    act(() => {
      trip.confirmPlace({
        label: "London",
        iataCode: "LON",
        airportIatas: ["LHR"],
        lat: 51.5074,
        lng: -0.1278,
      });
      trip.setDestinationQuery("Lond");
    });

    expect(screen.getByTestId("destination-iata")).toHaveTextContent("none");
    expect(screen.getByTestId("destination-airports")).toHaveTextContent("none");
  });

});
