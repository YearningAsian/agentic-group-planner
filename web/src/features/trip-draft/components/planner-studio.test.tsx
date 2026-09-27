import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLIGHT_ORIGIN_KEY } from "@/features/trip-draft/browse-offers";
import { stayCardsForDestination } from "@/lib/providers/stays/mock";
import { QUESTIONNAIRE_KICKOFF_KEY, questionnaireBrief } from "@/features/trip-draft/format";
import { PlannerStudio } from "./planner-studio";
import type { TripState } from "@/features/trip-draft/trip-context";

const tripMap = vi.fn((_: unknown) => <div data-testid="trip-map" />);
const confirmDestination = vi.fn();
const lockStay = vi.fn();
const chooseStay = vi.fn();
const chooseFlight = vi.fn();

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
      chooseStay,
      chooseFlight,
    }),
  };
});

describe("PlannerStudio", () => {
  beforeEach(() => {
    currentState = state();
    sessionStorage.removeItem(QUESTIONNAIRE_KICKOFF_KEY);
    sessionStorage.removeItem(FLIGHT_ORIGIN_KEY);
    confirmDestination.mockClear();
    lockStay.mockClear();
    chooseStay.mockClear();
    chooseFlight.mockClear();
    tripMap.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/planner/chat") {
          return new Response(
            `${JSON.stringify({ type: "text", delta: "Noted." })}\n${JSON.stringify({ type: "done" })}\n`,
            { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
          );
        }
        const stays = stayCardsForDestination(url.searchParams.get("destinationId"));
        return new Response(JSON.stringify({ stays }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the questionnaire brief once when the kickoff flag is set", async () => {
    currentState = state({
      destinationId: "lisbon",
      destinationLabel: "Lisbon",
      destinationIata: "LIS",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      budget: 1200,
      dietary: ["Vegetarian"],
      vibes: ["Food", "Nightlife"],
      members: [
        { id: "p1", name: "Alex", joined: true, placeholder: false },
        { id: "p2", name: "Sam", joined: true, placeholder: false },
        { id: "p3", name: "Jordan", joined: false, placeholder: true },
      ],
    });
    sessionStorage.setItem(QUESTIONNAIRE_KICKOFF_KEY, "1");
    render(<PlannerStudio />);

    const brief = questionnaireBrief(currentState);
    expect(await screen.findByText(brief)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/planner/chat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(brief),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/planner/chat",
      expect.objectContaining({
        body: expect.stringContaining('"fromQuestionnaire":true'),
      }),
    );
    expect(sessionStorage.getItem(QUESTIONNAIRE_KICKOFF_KEY)).toBeNull();
    expect(screen.queryByText(/Alfama townhouse/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose room/i })).not.toBeInTheDocument();
  });

  it("does not message the agent when studio opens without the kickoff flag", () => {
    currentState = state({
      destinationId: "lisbon",
      destinationLabel: "Lisbon",
      destinationIata: "LIS",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      budget: 1200,
    });
    render(<PlannerStudio />);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Plan a trip to Lisbon/)).not.toBeInTheDocument();
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

  it("shows stays as unavailable when Duffel search fails", async () => {
    currentState = state({ destinationId: "lisbon", startDate: "2026-06-01", endDate: "2026-06-04" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 })),
    );
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));

    expect(await screen.findByText(/stays are unavailable right now/i)).toBeInTheDocument();
  });

  it("shows Browse stays before a destination is confirmed", async () => {
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));

    expect(screen.getByText(/tell me where the group wants to stay/i)).toBeInTheDocument();
  });

  it("browses stays in the destination city, not the departure city", async () => {
    currentState = state({
      destinationLabel: "Tokyo",
      destinationIata: "TYO",
      destinationLat: null,
      destinationLng: null,
      originLabel: "Atlanta",
      originIata: "ATL",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            stays: [
              {
                id: "acc_tyo",
                name: "Park Hyatt Tokyo",
                image: null,
                area: "Shinjuku",
                guestScore: 9.1,
                reviewCount: 40,
                starRating: 5,
                nightlyAmount: 420,
                currency: "USD",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));

    expect(await screen.findByRole("heading", { name: /park hyatt tokyo/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("place=Tokyo"), expect.anything());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("iata=TYO"), expect.anything());
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("place=Atlanta"), expect.anything());
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("lat="), expect.anything());
  });

  it("opens Browse stays around the area named in chat", async () => {
    currentState = state({ startDate: "2026-06-01", endDate: "2026-06-04" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/planner/chat") {
          return new Response(
            [
              JSON.stringify({ type: "stayArea", label: "Alfama", lat: 38.71, lng: -9.13 }),
              JSON.stringify({ type: "text", delta: "Which dates should I use?" }),
              JSON.stringify({ type: "done" }),
              "",
            ].join("\n"),
            { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
          );
        }
        return new Response(
          JSON.stringify({
            stays: [
              {
                id: "acc_alfama",
                name: "Alfama House",
                image: null,
                area: "Alfama",
                guestScore: 9,
                reviewCount: 12,
                starRating: 4,
                nightlyAmount: 180,
                currency: "EUR",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "We want Alfama");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("heading", { name: /alfama house/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("lat=38.71"), expect.anything());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("lng=-9.13"), expect.anything());
  });

  it("returns to the same chat thread after closing browse", async () => {
    currentState = state({ destinationId: "lisbon", startDate: "2026-06-01", endDate: "2026-06-04" });
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "We need a quiet street.");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(screen.getByText("We need a quiet street.")).toBeInTheDocument();
    expect(await screen.findByText("Noted.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));
    expect(screen.queryByLabelText(/message the trip agent/i)).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /alfama townhouse/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back to chat/i }));
    expect(screen.getByText("We need a quiet street.")).toBeInTheDocument();
    expect(screen.getByLabelText(/message the trip agent/i)).toBeInTheDocument();
  });

  it("chooses one browse hotel for the summary", async () => {
    currentState = state({ destinationId: "lisbon", startDate: "2026-06-01", endDate: "2026-06-04" });
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));
    const link = await screen.findByRole("link", { name: /view tile-roof flat/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("/stays/lisbon-stay-1");
    await userEvent.click(screen.getByRole("button", { name: /choose this hotel: tile-roof flat/i }));

    expect(chooseStay).toHaveBeenCalledWith(expect.objectContaining({ id: "lisbon-stay-1", name: "Tile-roof flat" }));
  });

  it("chooses one browse flight for the summary", async () => {
    currentState = state({
      destinationId: "lisbon",
      originLabel: "New York",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
    });
    const flight = {
      airline: "TAP",
      origin: "JFK",
      destination: "LIS",
      departureTime: "2026-06-01T08:00:00",
      arrivalTime: "2026-06-01T18:00:00",
      stops: 0,
      price: 400,
      totalPrice: 400,
      currency: "USD",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/flights/search") {
          return new Response(JSON.stringify({ flights: [flight] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ stays: [] }), { status: 200 });
      }),
    );
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse flights/i }));
    await userEvent.click(await screen.findByRole("button", { name: /choose this flight: tap/i }));

    expect(chooseFlight).toHaveBeenCalledWith(flight);
  });

  it("chooses one chat hotel and flight for the summary", async () => {
    const flight = {
      airline: "TAP",
      origin: "JFK",
      destination: "LIS",
      departureTime: "2026-06-01T08:00:00",
      arrivalTime: "2026-06-01T18:00:00",
      stops: 0,
      price: 400,
      totalPrice: 400,
      currency: "USD",
    };
    const hotel = {
      id: "acc_harbor",
      name: "Harbor Test Hotel",
      location: "Alfama",
      image: null,
      pricePerNight: 210,
      totalPrice: 630,
      currency: "EUR",
      rating: 8.6,
      amenities: ["Wifi"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = [
          JSON.stringify({ type: "text", delta: "Here are options." }),
          JSON.stringify({ type: "cards", flights: [flight], hotels: [hotel] }),
          JSON.stringify({ type: "done" }),
          "",
        ].join("\n");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
      }),
    );
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "Find a flight and hotel");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(await screen.findByRole("button", { name: /choose this flight: tap/i }));
    await userEvent.click(screen.getByRole("button", { name: /choose this hotel: harbor test hotel/i }));

    expect(chooseFlight).toHaveBeenCalledWith(flight);
    expect(chooseStay).toHaveBeenCalledWith({
      id: "acc_harbor",
      name: "Harbor Test Hotel",
      area: "Alfama",
      nightlyAmount: 210,
      currency: "EUR",
      guestScore: 8.6,
      image: null,
    });
  });

  it("locks the committed flight and hotel without a second choose click", async () => {
    const flight = {
      airline: "TAP",
      origin: "JFK",
      destination: "LIS",
      departureTime: "2026-06-01T08:00:00",
      arrivalTime: "2026-06-01T18:00:00",
      stops: 0,
      price: 400,
      totalPrice: 400,
      currency: "USD",
    };
    const hotel = {
      id: "acc_harbor",
      name: "Harbor Test Hotel",
      location: "Alfama",
      image: null,
      pricePerNight: 210,
      totalPrice: 630,
      currency: "EUR",
      rating: 8.6,
      amenities: ["Wifi"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = [
          JSON.stringify({ type: "text", delta: "Based on that, I'd go with TAP and Harbor Test Hotel." }),
          JSON.stringify({ type: "cards", flights: [flight], hotels: [hotel], commit: true }),
          JSON.stringify({ type: "done" }),
          "",
        ].join("\n");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
      }),
    );
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "Find a flight and hotel");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/based on that, i'd go with tap/i)).toBeInTheDocument();
    expect(chooseFlight).toHaveBeenCalledWith(flight);
    expect(chooseStay).toHaveBeenCalledWith({
      id: "acc_harbor",
      name: "Harbor Test Hotel",
      area: "Alfama",
      nightlyAmount: 210,
      currency: "EUR",
      guestScore: 8.6,
      image: null,
    });
  });

  it("counts a clarifying question before the next message", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        const clarify = bodies.length === 1;
        const body = clarify
          ? [
              JSON.stringify({ type: "clarify" }),
              JSON.stringify({ type: "text", delta: "Which matters more, price or time?" }),
              JSON.stringify({ type: "done" }),
              "",
            ].join("\n")
          : [JSON.stringify({ type: "text", delta: "Noted." }), JSON.stringify({ type: "done" }), ""].join("\n");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
      }),
    );
    render(<PlannerStudio />);

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "Plan Miami");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/price or time/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/message the trip agent/i), "price");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText("Noted.")).toBeInTheDocument();

    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({ fromQuestionnaire: false, clarifyCount: 0 });
    expect(JSON.parse(bodies[1] ?? "{}")).toMatchObject({ clarifyCount: 1 });
  });

  it("sends price-bubble markers to the map only while browsing", async () => {
    currentState = state({ destinationId: "lisbon" });
    render(<PlannerStudio />);

    expect(tripMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markers: expect.arrayContaining([
          expect.objectContaining({ id: "lisbon-stay-0", label: "Alfama", variant: "place" }),
        ]),
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));

    expect(tripMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markers: expect.arrayContaining([
          expect.objectContaining({ id: "lisbon-stay-0", label: "$168", variant: "price" }),
        ]),
      }),
    );
  });

  it("keeps only stays that fit the per-person budget", async () => {
    currentState = state({
      destinationId: "lisbon",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      budget: 400,
    });
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse stays/i }));

    expect(await screen.findByRole("heading", { name: /tile-roof flat/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /alfama townhouse/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /river-view loft/i })).not.toBeInTheDocument();
  });

  it("asks for a departure city before searching flights", async () => {
    currentState = state({ destinationId: "lisbon", startDate: "2026-06-01", endDate: "2026-06-04" });
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse flights/i }));

    expect(screen.getByText(/where you're flying from/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("browses Duffel flights from the remembered departure city, trip destination, and budget", async () => {
    sessionStorage.setItem(FLIGHT_ORIGIN_KEY, "New York");
    currentState = state({
      destinationId: "lisbon",
      destinationIata: "LIS",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      budget: 500,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/flights/search") {
          expect(url.searchParams.get("origin")).toBe("New York");
          expect(url.searchParams.get("destination")).toBe("LIS");
          expect(url.searchParams.get("departureDate")).toBe("2026-06-01");
          expect(url.searchParams.get("returnDate")).toBe("2026-06-04");
          return new Response(
            JSON.stringify({
              flights: [
                flightOffer("TAP", 420),
                flightOffer("Pricey", 900),
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ stays: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    render(<PlannerStudio />);

    await userEvent.click(screen.getByRole("button", { name: /browse flights/i }));

    expect(await screen.findByText("TAP")).toBeInTheDocument();
    expect(screen.queryByText("Pricey")).not.toBeInTheDocument();
  });
});

function flightOffer(airline: string, price: number) {
  return {
    airline,
    origin: "JFK",
    destination: "LIS",
    departureTime: "2026-06-01T08:00:00",
    arrivalTime: "2026-06-01T20:00:00",
    stops: 0,
    price,
    totalPrice: price,
    currency: "USD",
  };
}
