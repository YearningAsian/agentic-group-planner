import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TripsBoard } from "./trips-board";
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

const { selectTrip, deleteTrip } = vi.hoisted(() => ({
  selectTrip: vi.fn(),
  deleteTrip: vi.fn(),
}));

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
      selectTrip,
      deleteTrip,
    }),
  };
});

function seedLisbonTrip() {
  mockState = {
    ...mockState,
    id: "trip-1",
    destinationId: "lisbon",
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
}

describe("TripsBoard", () => {
  beforeEach(() => {
    selectTrip.mockClear();
    deleteTrip.mockClear();
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

  it("renders empty state when user has not created any trips", () => {
    render(<TripsBoard />);
    expect(screen.getByText(/no trips yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create your first trip/i })).toBeInTheDocument();
    // Verify demo trips are not rendered
    expect(screen.queryByText(/porto long weekend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/denver ski weekend/i)).not.toBeInTheDocument();
  });

  it("renders user-created trip cards when trips exist", () => {
    seedLisbonTrip();

    render(<TripsBoard />);
    expect(screen.queryByText(/no trips yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/trip to lisbon/i)).toBeInTheDocument();
  });

  it("selects the trip before navigating to studio or summary", async () => {
    seedLisbonTrip();
    render(<TripsBoard />);

    const studio = screen.getByRole("link", { name: /studio/i });
    const summary = screen.getByRole("link", { name: /summary/i });
    expect(studio).toHaveAttribute("href", "/studio");
    expect(summary).toHaveAttribute("href", "/current");

    await userEvent.click(studio);
    expect(selectTrip).toHaveBeenCalledWith("trip-1");

    selectTrip.mockClear();
    await userEvent.click(summary);
    expect(selectTrip).toHaveBeenCalledWith("trip-1");
  });

  it("deletes a trip after confirmation", async () => {
    seedLisbonTrip();
    render(<TripsBoard />);

    await userEvent.click(screen.getByRole("button", { name: /delete trip to lisbon/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(deleteTrip).toHaveBeenCalledWith("trip-1");
  });

  it("keeps the trip when delete is cancelled", async () => {
    seedLisbonTrip();
    render(<TripsBoard />);

    await userEvent.click(screen.getByRole("button", { name: /delete trip to lisbon/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteTrip).not.toHaveBeenCalled();
  });
});
