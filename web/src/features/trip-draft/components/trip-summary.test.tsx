import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChosenFlight, ChosenStay } from "@/features/trip-draft/chosen-travel";
import type { TripState } from "@/features/trip-draft/trip-context";
import { TripSummary } from "./trip-summary";

vi.mock("next/image", () => ({
  default: ({ alt = "", ...props }: { alt?: string; src?: string }) => <img alt={alt} {...props} />,
}));

vi.mock("@/features/trip-draft/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/trip-draft/components/trip-map", () => ({
  TripMap: () => <div data-testid="trip-map" />,
}));

const chosenFlight: ChosenFlight = {
  id: "TAP-JFK-LIS-2026-06-01T08:00:00-400",
  airline: "TAP",
  origin: "JFK",
  destination: "LIS",
  departure: "2026-06-01T08:00:00",
  arrival: "2026-06-01T18:00:00",
  stops: 0,
  price: 400,
  currency: "USD",
};

const chosenStay: ChosenStay = {
  id: "acc_harbor",
  name: "Harbor Test Hotel",
  area: "Alfama",
  nightlyAmount: 210,
  currency: "EUR",
  guestScore: 8.6,
  image: null,
};

function state(overrides: Partial<TripState> = {}): TripState {
  return {
    destinationId: "lisbon",
    destinationQuery: "Lisbon",
    pinDropped: true,
    startDate: "2026-06-01",
    endDate: "2026-06-04",
    budget: null,
    dietary: [],
    vibes: [],
    members: [
      {
        id: "p1",
        name: "Person 1",
        joined: true,
        placeholder: false,
        flightId: chosenFlight.id,
        stayId: chosenStay.id,
      },
    ],
    lockedFlightId: chosenFlight.id,
    lockedStayId: chosenStay.id,
    chosenFlight,
    chosenStay,
    compareFlightIds: [],
    compareStayIds: [],
    comparingFlights: false,
    comparingStays: false,
    inviteShared: false,
    didSimulateJoin: true,
    justJoinedName: null,
    ...overrides,
  };
}

let currentState = state();

vi.mock("@/features/trip-draft/trip-context", async () => {
  const actual = await vi.importActual<typeof import("@/features/trip-draft/trip-context")>(
    "@/features/trip-draft/trip-context",
  );
  return {
    ...actual,
    useTrip: () => ({
      state: currentState,
      lockFlight: vi.fn(),
      lockStay: vi.fn(),
      assignFlight: vi.fn(),
      assignStay: vi.fn(),
      markInviteShared: vi.fn(),
      markFirstPendingJoined: vi.fn(),
    }),
  };
});

describe("TripSummary live choices", () => {
  beforeEach(() => {
    currentState = state();
  });

  it("shows the chosen flight and hotel when their ids are not fixtures", () => {
    render(<TripSummary />);

    expect(screen.getByText("TAP · Locked")).toBeInTheDocument();
    expect(screen.getAllByText("JFK → LIS").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Harbor Test Hotel" })).toBeInTheDocument();
    expect(screen.getByText(/8\.6 guest score/)).toBeInTheDocument();
    expect(screen.getByText(/TAP \+ Harbor Test Hotel/)).toBeInTheDocument();
  });

  it("keeps the fixture stay when the saved hotel does not match the lock", () => {
    currentState = state({
      lockedStayId: "lisbon-stay-0",
      chosenStay: null,
      members: [
        {
          id: "p1",
          name: "Person 1",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: "lisbon-stay-0",
        },
      ],
    });
    render(<TripSummary />);

    expect(screen.queryByRole("heading", { name: "Harbor Test Hotel" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alfama townhouse" })).toBeInTheDocument();
  });
});
