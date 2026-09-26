import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerStudio } from "./planner-studio";
import type { TripState } from "@/features/trip-draft/trip-context";

const tripMap = vi.fn((_: unknown) => <div data-testid="trip-map" />);
const confirmDestination = vi.fn();
const lockStay = vi.fn();

function state(overrides: Partial<TripState> = {}): TripState {
  return {
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

let currentState = state();

vi.mock("next/image", () => ({
  default: ({ alt = "", ...props }: { alt?: string; src?: string }) => <img alt={alt} {...props} />,
}));

vi.mock("@/features/trip-draft/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/trip-draft/components/trip-map", () => ({
  TripMap: (props: unknown) => tripMap(props),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    nativeButton: _nativeButton,
    render,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    nativeButton?: boolean;
    render?: React.ReactElement<React.AnchorHTMLAttributes<HTMLAnchorElement>>;
  }) => {
    if (render) return <a {...render.props}>{children}</a>;
    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>
      <div data-slot="scroll-area-viewport">{children}</div>
    </div>
  ),
}));

vi.mock("@/features/trip-draft/trip-context", async () => {
  const actual = await vi.importActual<typeof import("@/features/trip-draft/trip-context")>(
    "@/features/trip-draft/trip-context",
  );
  return {
    ...actual,
    useTrip: () => ({
      state: currentState,
      confirmDestination,
      lockStay,
    }),
  };
});

describe("PlannerStudio", () => {
  beforeEach(() => {
    currentState = state();
    confirmDestination.mockClear();
    lockStay.mockClear();
    tripMap.mockClear();
  });

  it("keeps an empty draft empty instead of showing the Barcelona sample as saveable", () => {
    render(<PlannerStudio />);

    expect(screen.getByRole("link", { name: /start the questionnaire/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose room/i })).not.toBeInTheDocument();
    expect(tripMap).toHaveBeenCalledWith(expect.objectContaining({ focus: null, pinned: false }));
  });

  it("accepts an exact city message from an empty draft", async () => {
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "Lisbon");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(confirmDestination).toHaveBeenCalledWith("lisbon");
  });

  it("marks stays over budget using the trip total for the selected nights", () => {
    currentState = state({
      destinationId: "lisbon",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      budget: 250,
    });

    render(<PlannerStudio />);

    expect(screen.getAllByText("Over budget")).toHaveLength(2);
  });
});
