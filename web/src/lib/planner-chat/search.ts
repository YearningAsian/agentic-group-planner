import type { FlightOffer } from "@/lib/providers/flights/types";
import { loadSampleCatalog } from "@/lib/demo/load-sample-catalog";
import {
  matchSampleDestination,
  sampleFaresFromNewYork,
  sampleFlightOffers,
  sampleHotelOffers,
  type SampleCatalog,
} from "@/lib/demo/sample-catalog";
import type { FlightSearchParams, HotelSearchParams } from "./schema";
import { flightDateError, hotelDateError } from "./schema";
import { FLIGHT_UNAVAILABLE, HOTEL_UNAVAILABLE, type HotelOffer, type StayArea } from "./types";

const MAX_HOTELS = 5;

export interface SearchDeps {
  /** Sample catalog. When omitted, the cities row is loaded from Supabase. */
  catalog?: SampleCatalog;
}

export type FlightToolResult =
  | { ok: true; flights: FlightOffer[]; note?: string }
  | { ok: false; error: string };

export type HotelToolResult =
  | { ok: true; hotels: HotelOffer[]; note?: string; area?: StayArea }
  | { ok: false; error: string };

export type StayAreaResult = { ok: true; label: string; lat: number; lng: number } | { ok: false; error: string };

export async function executeFlightSearch(input: FlightSearchParams, deps: SearchDeps = {}): Promise<FlightToolResult> {
  const dateError = flightDateError(input);
  if (dateError) return { ok: false, error: dateError };

  try {
    const catalog = await catalogOf(deps);
    const destination = matchSampleDestination(catalog, input.destination);
    if (!destination) return { ok: true, flights: [], note: "No flights matched that search." };
    const flights = sampleFlightOffers(catalog, destination, input);
    if (flights.length === 0) return { ok: true, flights: [], note: "No flights matched that search." };
    const note = sampleFaresFromNewYork(input.origin) ? undefined : "Sample fares are round-trip from New York.";
    return note ? { ok: true, flights, note } : { ok: true, flights };
  } catch {
    return { ok: false, error: FLIGHT_UNAVAILABLE };
  }
}

export async function executeHotelSearch(input: HotelSearchParams, deps: SearchDeps = {}): Promise<HotelToolResult> {
  const dateError = hotelDateError(input);
  if (dateError) return { ok: false, error: dateError };

  try {
    const catalog = await catalogOf(deps);
    const destination = matchSampleDestination(catalog, input.destination);
    if (!destination) return { ok: false, error: `I couldn't find a stay area for ${input.destination.trim()}.` };
    const hotels = sampleHotelOffers(catalog, destination, input.checkIn, input.checkOut).slice(0, MAX_HOTELS);
    const area: StayArea = { label: destination.label, lat: destination.lat, lng: destination.lng };
    if (hotels.length === 0) return { ok: true, hotels: [], note: "No hotels matched that search.", area };
    return { ok: true, hotels, area };
  } catch {
    return { ok: false, error: HOTEL_UNAVAILABLE };
  }
}

/** Records a sample-catalog city. No prices. */
export async function noteStayArea(place: string, deps: SearchDeps = {}): Promise<StayAreaResult> {
  try {
    const catalog = await catalogOf(deps);
    const destination = matchSampleDestination(catalog, place);
    if (!destination) return { ok: false, error: `I couldn't find a stay area for ${place.trim()}.` };
    return { ok: true, label: destination.label, lat: destination.lat, lng: destination.lng };
  } catch {
    return { ok: false, error: HOTEL_UNAVAILABLE };
  }
}

async function catalogOf(deps: SearchDeps): Promise<SampleCatalog> {
  return deps.catalog ?? loadSampleCatalog();
}

const MODEL_AMENITIES = 3;

/** Short text for the model. Cards still use the full tool result. */
export function flightModelText(result: FlightToolResult): string {
  if (!result.ok) return result.error;
  if (result.flights.length === 0) return result.note ?? "No flights.";
  const lines = result.flights.map((flight) => {
    const id = flight.flightNumber ? `${flight.flightNumber} ` : "";
    const back = flight.returnDepartureTime
      ? ` back ${hhmm(flight.returnDepartureTime)}-${hhmm(flight.returnArrivalTime)}`
      : "";
    return `${id}${flight.airline} ${flight.origin}-${flight.destination} ${hhmm(flight.departureTime)}-${hhmm(flight.arrivalTime)}${back} ${flight.stops} stops ${money(flight.currency, flight.price)}`;
  });
  return joinNote(result.note, lines);
}

export function hotelModelText(result: HotelToolResult): string {
  if (!result.ok) return result.error;
  if (result.hotels.length === 0) return result.note ?? "No hotels.";
  const lines = result.hotels.map((hotel) => {
    const where = hotel.location ? ` ${hotel.location}` : "";
    const nightly = hotel.pricePerNight != null ? ` ${money(hotel.currency, hotel.pricePerNight)}/night` : "";
    const total = hotel.totalPrice != null ? ` ${money(hotel.currency, hotel.totalPrice)} total` : "";
    const rating = hotel.rating != null ? ` score ${hotel.rating}` : "";
    const amenities = hotel.amenities.slice(0, MODEL_AMENITIES).join(",");
    return `${hotel.name}${where}${nightly}${total}${rating}${amenities ? ` ${amenities}` : ""}`;
  });
  return joinNote(result.note, lines);
}

export function stayAreaModelText(result: StayAreaResult): string {
  if (!result.ok) return result.error;
  return result.label;
}

function joinNote(note: string | undefined, lines: string[]): string {
  return [note, ...lines].filter(Boolean).join("\n");
}

function hhmm(value: string | undefined): string {
  if (!value) return "";
  return /T(\d{2}:\d{2})/.exec(value)?.[1] ?? value;
}

function money(currency: string | null | undefined, amount: number): string {
  return `${currency ?? ""} ${amount}`.trim();
}
