// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStudioMemory } from "./studio-store";
import type { TripRecord } from "./trips-db";
import type { FlightOffer } from "@/lib/providers/flights/types";
import type { StayCard } from "@/lib/providers/stays/types";
import { resetTripContextForTests, TripProvider, useTrip, type TripState } from "./trip-context";

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
      <span data-testid="round-trip">{value.state.roundTrip === false ? "no" : "yes"}</span>
      <span data-testid="chosen-flight">{value.state.chosenFlight?.airline ?? "none"}</span>
      <span data-testid="chosen-flight-id">{value.state.chosenFlight?.id ?? "none"}</span>
      <span data-testid="chosen-stay">{value.state.chosenStay?.name ?? "none"}</span>
      <span data-testid="locked-flight">{value.state.lockedFlightId ?? "none"}</span>
      <span data-testid="locked-stay">{value.state.lockedStayId ?? "none"}</span>
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
    resetTripContextForTests();
  });

  afterEach(() => {
    if (api) {
      act(() => api?.startNewTrip());
    }
    api = null;
  });

  it("keeps legacy locked picks visible as the organizer choices", () => {
    resetStudioMemory({ activeTripId: "trip-legacy", trips: [legacyRecord()] });

    renderProvider();

    expect(screen.getByTestId("organizer-flight")).toHaveTextContent("lisbon-flight-1");
    expect(screen.getByTestId("organizer-stay")).toHaveTextContent("lisbon-stay-1");
    expect(screen.getByTestId("destination-iata")).toHaveTextContent("LIS");
    expect(screen.getByTestId("destination-label")).toHaveTextContent("Lisbon");
    expect(screen.getByTestId("round-trip")).toHaveTextContent("yes");
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
    expect(screen.getByTestId("destination")).toHaveTextContent("london");
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

  it("stores one chosen flight and replaces it with the next choice", () => {
    const trip = renderProvider();
    const first = flightOffer({ airline: "Delta", price: 400, departureTime: "2026-06-01T08:00:00" });
    const second = flightOffer({ airline: "TAP", price: 350, departureTime: "2026-06-01T10:00:00" });

    act(() => trip.chooseFlight(first));

    expect(screen.getByTestId("chosen-flight")).toHaveTextContent("Delta");
    expect(screen.getByTestId("chosen-flight-id")).toHaveTextContent("Delta-JFK-LIS-2026-06-01T08:00:00-400");
    expect(screen.getByTestId("locked-flight")).toHaveTextContent("Delta-JFK-LIS-2026-06-01T08:00:00-400");
    expect(screen.getByTestId("organizer-flight")).toHaveTextContent("Delta-JFK-LIS-2026-06-01T08:00:00-400");

    act(() => trip.chooseFlight(second));

    expect(screen.getByTestId("chosen-flight")).toHaveTextContent("TAP");
    expect(screen.getByTestId("chosen-flight-id")).toHaveTextContent("TAP-JFK-LIS-2026-06-01T10:00:00-350");
    expect(screen.getByTestId("locked-flight")).toHaveTextContent("TAP-JFK-LIS-2026-06-01T10:00:00-350");
  });

  it("stores one chosen stay and clears both choices when the destination changes", () => {
    const trip = renderProvider();

    act(() => {
      trip.confirmDestination("lisbon");
      trip.chooseFlight(flightOffer({ airline: "Delta", price: 400, departureTime: "2026-06-01T08:00:00" }));
      trip.chooseStay(stayCard());
    });

    expect(screen.getByTestId("chosen-stay")).toHaveTextContent("Harbor Test Hotel");
    expect(screen.getByTestId("locked-stay")).toHaveTextContent("acc_harbor");
    expect(screen.getByTestId("organizer-stay")).toHaveTextContent("acc_harbor");

    act(() => trip.chooseStay(stayCard({ id: "acc_other", name: "Other Hotel" })));

    expect(screen.getByTestId("chosen-stay")).toHaveTextContent("Other Hotel");
    expect(screen.getByTestId("locked-stay")).toHaveTextContent("acc_other");

    act(() => trip.confirmDestination("kyoto"));

    expect(screen.getByTestId("chosen-flight")).toHaveTextContent("none");
    expect(screen.getByTestId("chosen-stay")).toHaveTextContent("none");
    expect(screen.getByTestId("locked-flight")).toHaveTextContent("none");
    expect(screen.getByTestId("locked-stay")).toHaveTextContent("none");
  });

});

function flightOffer(overrides: Partial<FlightOffer>): FlightOffer {
  return {
    airline: "Delta",
    origin: "JFK",
    destination: "LIS",
    departureTime: "2026-06-01T08:00:00",
    arrivalTime: "2026-06-01T18:00:00",
    stops: 0,
    price: 400,
    totalPrice: 400,
    currency: "USD",
    ...overrides,
  };
}

function stayCard(overrides: Partial<StayCard> = {}): StayCard {
  return {
    id: "acc_harbor",
    name: "Harbor Test Hotel",
    image: null,
    area: "Alfama",
    guestScore: 8.6,
    reviewCount: 20,
    starRating: 4,
    nightlyAmount: 210,
    currency: "EUR",
    ...overrides,
  };
}
