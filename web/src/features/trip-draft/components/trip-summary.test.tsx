import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const { assignFlight, assignStay } = vi.hoisted(() => ({
  assignFlight: vi.fn(),
  assignStay: vi.fn(),
}));

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
      assignFlight,
      assignStay,
      markInviteShared: vi.fn(),
      markFirstPendingJoined: vi.fn(),
      setShareCode: vi.fn(),
    }),
  };
});

describe("TripSummary live choices", () => {
  beforeEach(() => {
    currentState = state();
    sessionStorage.clear();
    assignFlight.mockClear();
    assignStay.mockClear();
  });

  it("shows the chosen flight and hotel when their ids are not fixtures", () => {
    render(<TripSummary />);

    expect(screen.getByText("TAP · Locked")).toBeInTheDocument();
    expect(screen.getAllByText("JFK → LIS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Harbor Test Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Harbor Test Hotel · Locked")).toBeInTheDocument();
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

    expect(screen.queryByText("Harbor Test Hotel")).not.toBeInTheDocument();
    expect(screen.getByText("Alfama townhouse")).toBeInTheDocument();
  });

  it("unlocks organizer checkout after every joined traveler confirms", async () => {
    const user = userEvent.setup();
    currentState = state({
      chosenStay: { ...chosenStay, currency: "USD" },
      members: [1, 2].map((n) => ({
        id: `p${n}`,
        name: `Person ${n}`,
        joined: true,
        placeholder: false,
        flightId: chosenFlight.id,
        stayId: chosenStay.id,
      })),
    });
    render(<TripSummary />);

    const flights = screen.getByRole("heading", { name: "Flights" });
    const hotels = screen.getByRole("heading", { name: "Hotels" });
    const groupBuy = screen.getByRole("heading", { name: "Group buy" });
    expect(flights.compareDocumentPosition(groupBuy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hotels.compareDocumentPosition(groupBuy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toBeDisabled();
    await user.click(screen.getAllByRole("button", { name: "Confirm I'll pay" })[0]!);
    expect(checkout).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm I'll pay" }));
    expect(checkout).toBeEnabled();
  });

  it("shows a hold as held or paid, and names who the group is waiting on", () => {
    sessionStorage.setItem(
      "group-buy-holds",
      JSON.stringify([
        { memberId: "a", name: "Ada", url: null, totalCents: 4800, currency: "USD", status: "authorized" },
        { memberId: "b", name: "Bea", url: null, totalCents: 4800, currency: "USD", status: "captured" },
        { memberId: "c", name: "Cam", url: null, totalCents: 4800, currency: "USD", status: "declined" },
      ]),
    );
    render(<TripSummary />);
    expect(screen.getByText("Held")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Waiting on Cam")).toBeInTheDocument();
  });

  it("charges the group once every card is held", async () => {
    const user = userEvent.setup();
    currentState = state({ chosenStay: { ...chosenStay, currency: "USD" } });
    sessionStorage.setItem(
      "group-buy-holds",
      JSON.stringify([
        {
          memberId: "p1",
          name: "Person 1",
          url: "https://checkout.stripe.test/pay/cs_test_held",
          sessionId: "cs_test_held",
          totalCents: 103000,
          currency: "USD",
          status: "authorized",
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/group-checkout/capture")) {
        return { ok: true, json: async () => ({ state: "captured" }) };
      }
      return { ok: true, json: async () => ({ state: "authorized", memberId: "p1" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<TripSummary />);
      await user.click(screen.getByRole("button", { name: "Checkout for the group" }));
      expect(await screen.findByText("Paid")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/group-checkout/capture",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sessionId: "cs_test_held" }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets another joined person pick the same locked flight", async () => {
    currentState = state({
      members: [
        {
          id: "p1",
          name: "Person 1",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: chosenStay.id,
        },
        {
          id: "p2",
          name: "Person 2",
          joined: true,
          placeholder: false,
          flightId: null,
          stayId: null,
        },
      ],
    });
    render(<TripSummary />);

    await userEvent.click(screen.getByRole("button", { name: "Pick this flight for Person 2" }));

    expect(assignFlight).toHaveBeenCalledWith("p2", chosenFlight.id);
    expect(assignStay).not.toHaveBeenCalled();
  });

  it("folds a fourth person into the tray until it is opened", async () => {
    currentState = state({
      members: [1, 2, 3, 4].map((n) => ({
        id: `p${n}`,
        name: `Person ${n}`,
        joined: true,
        placeholder: false,
        flightId: n === 1 ? chosenFlight.id : null,
        stayId: n === 1 ? chosenStay.id : null,
      })),
    });
    render(<TripSummary />);

    expect(screen.queryByRole("button", { name: "Pick this flight for Person 4" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Show 2 more people" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Pick this flight for Person 4" }));

    expect(assignFlight).toHaveBeenCalledWith("p4", chosenFlight.id);
  });

  it("lets another joined person pick the same locked hotel", async () => {
    currentState = state({
      members: [
        {
          id: "p1",
          name: "Person 1",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: chosenStay.id,
        },
        {
          id: "p2",
          name: "Person 2",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: null,
        },
      ],
    });
    render(<TripSummary />);

    await userEvent.click(screen.getByRole("button", { name: "Pick this stay for Person 2" }));

    expect(assignStay).toHaveBeenCalledWith("p2", chosenStay.id);
    expect(assignFlight).not.toHaveBeenCalled();
  });

  it("folds a fourth person into the hotel tray until it is opened", async () => {
    currentState = state({
      members: [1, 2, 3, 4].map((n) => ({
        id: `p${n}`,
        name: `Person ${n}`,
        joined: true,
        placeholder: false,
        flightId: n === 1 ? chosenFlight.id : null,
        stayId: n === 1 ? chosenStay.id : null,
      })),
    });
    render(<TripSummary />);

    const stayStrip = screen.getByLabelText("Choose stay by person");
    expect(within(stayStrip).queryByRole("button", { name: "Pick this stay for Person 4" })).not.toBeInTheDocument();
    await userEvent.click(within(stayStrip).getByRole("button", { name: "Show 2 more people" }));
    await userEvent.click(within(stayStrip).getByRole("button", { name: "Pick this stay for Person 4" }));

    expect(assignStay).toHaveBeenCalledWith("p4", chosenStay.id);
  });

  it("lets another joined person pick a shortlisted stay", async () => {
    currentState = state({
      members: [
        {
          id: "p1",
          name: "Person 1",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: chosenStay.id,
        },
        {
          id: "p2",
          name: "Person 2",
          joined: true,
          placeholder: false,
          flightId: chosenFlight.id,
          stayId: null,
        },
      ],
    });
    render(<TripSummary />);

    const hotels = screen.getByRole("heading", { name: "Hotels" }).closest("section");
    expect(hotels).not.toBeNull();
    await userEvent.click(within(hotels!).getByRole("button", { name: /Show all/ }));
    const row = within(hotels!).getByText("Alfama townhouse").closest("li");
    expect(row).not.toBeNull();
    await userEvent.click(within(row!).getByRole("button", { name: "Pick this stay for Person 2" }));

    expect(assignStay).toHaveBeenCalledWith("p2", "lisbon-stay-0");
    expect(assignFlight).not.toHaveBeenCalled();
  });
});
