import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardHome } from "./dashboard-home";
import type { TripState, TripRecord } from "@/features/trip-draft/trip-context";

vi.mock("next/image", () => ({
  default: ({ alt = "", ...props }: { alt?: string; src?: string }) => <img alt={alt} {...props} />,
}));

vi.mock("@/features/trip-draft/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let mockState: TripState = {
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
};

let mockTrips: TripRecord[] = [];

vi.mock("@/features/trip-draft/trip-context", async () => {
  const actual = await vi.importActual<typeof import("@/features/trip-draft/trip-context")>(
    "@/features/trip-draft/trip-context",
  );
  return {
    ...actual,
    useTrip: () => ({
      state: mockState,
      trips: mockTrips,
      activeTripId: mockState.id,
      hasTrips: mockTrips.length > 0,
      startNewTrip: vi.fn(),
      commitDraft: vi.fn(),
      selectTrip: vi.fn(),
      deleteTrip: vi.fn(),
      markInviteShared: vi.fn(),
    }),
  };
});

describe("DashboardHome", () => {
  beforeEach(() => {
    mockState = {
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
    };
    mockTrips = [];
  });

  it("renders empty dashboard state when no trips exist", () => {
    render(<DashboardHome />);
    expect(screen.getByText(/no trips planned yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start your first trip/i })).toBeInTheDocument();
    // Verify demo past trips are not rendered
    expect(screen.queryByText(/past trips/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lake tahoe cabin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/austin bachelor trip/i)).not.toBeInTheDocument();
    // Verify demo Barcelona is not rendered
    expect(screen.queryByText(/budget stays near barcelona/i)).not.toBeInTheDocument();
  });

  it("renders active trip card when a trip is created", () => {
    mockState = {
      ...mockState,
      id: "trip-1",
      destinationId: "lisbon",
      destinationQuery: "Lisbon",
      startDate: "2026-10-01",
      endDate: "2026-10-06",
    };
    mockTrips = [
      {
        ...mockState,
        id: "trip-1",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    render(<DashboardHome />);
    expect(screen.queryByText(/no trips planned yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/trip to lisbon/i)).toBeInTheDocument();
  });
});
