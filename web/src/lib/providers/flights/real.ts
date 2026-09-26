import { withPolicy } from "@/lib/reliability/with-policy";
import type { FlightOffer, FlightSearchInput, FlightsProvider } from "./types";

// Duffel isolates test and live data. This adapter only accepts a duffel_test_ token
// (enforced in web/src/lib/env/server.ts). Never put a duffel_live_ token in DUFFEL_ACCESS_TOKEN.
const POLICY = { timeoutMs: 20_000, retries: 0 } as const;
const API = "https://api.duffel.com/air/offer_requests";
const MAX_OFFERS = 5;

interface DuffelCarrier {
  iata_code?: string;
  name?: string;
}

interface DuffelPlace {
  iata_code?: string;
}

interface DuffelSegment {
  departing_at?: string;
  arriving_at?: string;
  marketing_carrier?: DuffelCarrier;
  marketing_carrier_flight_number?: string;
}

interface DuffelSlice {
  duration?: string;
  origin?: DuffelPlace;
  destination?: DuffelPlace;
  segments?: DuffelSegment[];
}

interface DuffelOffer {
  total_amount?: string;
  total_currency?: string;
  owner?: DuffelCarrier;
  slices?: DuffelSlice[];
}

export function createDuffelFlights(opts: { token: string; fetchImpl?: typeof fetch }): FlightsProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function searchOnce(input: FlightSearchInput, nonstop: boolean): Promise<DuffelOffer[]> {
    const body = await withPolicy(
      (signal) =>
        duffel<{ data?: { offers?: DuffelOffer[] } }>(
          fetchImpl,
          opts.token,
          { data: requestData(input, nonstop) },
          signal,
        ),
      POLICY,
    );
    return body.data?.offers ?? [];
  }

  return {
    async search(input) {
      const nonstop = input.nonstop === true;
      let offers = await searchOnce(input, nonstop);
      let note: string | undefined;
      if (offers.length === 0 && nonstop) {
        offers = await searchOnce(input, false);
        if (offers.length > 0) note = "No nonstop flights matched. These options have stops.";
      }

      const airline = input.airline?.trim();
      let matched = offers;
      if (airline) {
        const filtered = offers.filter((offer) => matchesAirline(offer, airline));
        if (filtered.length === 0 && offers.length > 0) {
          note = [note, `None of the returned flights are on ${airline}.`].filter(Boolean).join(" ");
        } else {
          matched = filtered;
        }
      }

      const flights = matched.flatMap((offer) => {
        const card = normalizeOffer(offer, input.travelers);
        return card ? [card] : [];
      }).slice(0, MAX_OFFERS);

      return note ? { flights, note } : { flights };
    },
  };
}

export function normalizeOffer(offer: DuffelOffer, travelers: number): FlightOffer | null {
  const outbound = offer.slices?.[0];
  const segments = outbound?.segments ?? [];
  const first = segments[0];
  const last = segments.at(-1);
  const totalPrice = numberOrNull(offer.total_amount);
  const currency = offer.total_currency;
  const origin = outbound?.origin?.iata_code;
  const destination = outbound?.destination?.iata_code;
  const airline = offer.owner?.name || first?.marketing_carrier?.name;
  if (!outbound || !first?.departing_at || !last?.arriving_at || totalPrice == null || !currency || !origin || !destination || !airline) {
    return null;
  }

  const flightNumbers = segments.flatMap((segment) => {
    const code = segment.marketing_carrier?.iata_code;
    const number = segment.marketing_carrier_flight_number;
    if (!code || !number) return [];
    return [`${code}${number}`];
  });
  const returning = offer.slices?.[1];
  const returnSegments = returning?.segments ?? [];
  const returnFirst = returnSegments[0]?.departing_at;
  const returnLast = returnSegments.at(-1)?.arriving_at;
  const party = Math.max(1, Math.floor(travelers));

  return {
    airline,
    ...(flightNumbers.length > 0 ? { flightNumber: flightNumbers.join(", ") } : {}),
    origin,
    destination,
    departureTime: first.departing_at,
    arrivalTime: last.arriving_at,
    ...(outbound.duration ? { duration: outbound.duration } : {}),
    stops: Math.max(0, segments.length - 1),
    price: totalPrice / party,
    totalPrice,
    currency,
    ...(returnFirst ? { returnDepartureTime: returnFirst } : {}),
    ...(returnLast ? { returnArrivalTime: returnLast } : {}),
  };
}

function requestData(input: FlightSearchInput, nonstop: boolean) {
  const travelers = Math.min(9, Math.max(1, Math.floor(input.travelers)));
  const departureTime = timeWindow(input.departureTimeFrom, input.departureTimeTo);
  const outbound: Record<string, unknown> = {
    origin: input.origin,
    destination: input.destination,
    departure_date: input.departureDate,
  };
  if (departureTime) outbound.departure_time = departureTime;
  const slices = [outbound];
  if (input.returnDate) {
    slices.push({
      origin: input.destination,
      destination: input.origin,
      departure_date: input.returnDate,
    });
  }
  return {
    slices,
    passengers: Array.from({ length: travelers }, () => ({ type: "adult" as const })),
    ...(input.cabinClass ? { cabin_class: input.cabinClass } : {}),
    ...(nonstop ? { max_connections: 0 } : {}),
  };
}

function timeWindow(from: string | undefined, to: string | undefined): { from?: string; to?: string } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function matchesAirline(offer: DuffelOffer, airline: string): boolean {
  const needle = airline.toLowerCase();
  const values = [
    offer.owner?.name,
    offer.owner?.iata_code,
    ...(offer.slices ?? []).flatMap((slice) =>
      (slice.segments ?? []).flatMap((segment) => [segment.marketing_carrier?.name, segment.marketing_carrier?.iata_code]),
    ),
  ];
  return values.some((value) => value?.toLowerCase().includes(needle));
}

async function duffel<T>(
  fetchImpl: typeof fetch,
  token: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetchImpl(API, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Duffel-Version": "v2",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  }
  return (await response.json()) as T;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
