import type { PlaceSuggestion, PlaceSuggestionsProvider } from "@/lib/providers/place-suggestions/types";
import { createDuffelPlaceSuggestions } from "@/lib/providers/place-suggestions";
import { createDuffelFlights } from "@/lib/providers/flights";
import type { FlightOffer, FlightsProvider } from "@/lib/providers/flights/types";
import { createDuffelStays } from "@/lib/providers/stays";
import { stayAreaForPlace } from "@/lib/providers/stays/place-point";
import type { StayCard, StaysProvider } from "@/lib/providers/stays/types";
import type { FlightSearchParams, HotelSearchParams } from "./schema";
import { flightDateError, hotelDateError } from "./schema";
import { FLIGHT_UNAVAILABLE, HOTEL_UNAVAILABLE, type HotelOffer, type StayArea } from "./types";

const MAX_HOTELS = 5;

export interface SearchDeps {
  duffelToken?: string;
  fetchImpl?: typeof fetch;
  places?: PlaceSuggestionsProvider;
  stays?: StaysProvider;
  flights?: FlightsProvider;
}

export type FlightToolResult =
  | { ok: true; flights: FlightOffer[]; note?: string }
  | { ok: false; error: string };

export type HotelToolResult =
  | { ok: true; hotels: HotelOffer[]; note?: string; area?: StayArea }
  | { ok: false; error: string };

export type StayAreaResult = { ok: true; label: string; lat: number; lng: number } | { ok: false; error: string };

export async function executeFlightSearch(input: FlightSearchParams, deps: SearchDeps): Promise<FlightToolResult> {
  const dateError = flightDateError(input);
  if (dateError) return { ok: false, error: dateError };
  if (!deps.duffelToken && !deps.flights) return { ok: false, error: FLIGHT_UNAVAILABLE };

  try {
    const places = placeClient(deps);
    const origin = await resolvePlace(input.origin, places, "flight");
    if (!origin.ok) return origin;
    const destination = await resolvePlace(input.destination, places, "flight");
    if (!destination.ok) return destination;

    const flights = deps.flights ?? createDuffelFlights({ token: deps.duffelToken!, fetchImpl: deps.fetchImpl });
    const result = await flights.search({
      ...input,
      origin: origin.place.iataCode,
      destination: destination.place.iataCode,
    });
    if (result.flights.length === 0) {
      return { ok: true, flights: [], note: result.note ?? "No flights matched that search." };
    }
    return result.note ? { ok: true, flights: result.flights, note: result.note } : { ok: true, flights: result.flights };
  } catch {
    return { ok: false, error: FLIGHT_UNAVAILABLE };
  }
}

export async function executeHotelSearch(input: HotelSearchParams, deps: SearchDeps): Promise<HotelToolResult> {
  const dateError = hotelDateError(input);
  if (dateError) return { ok: false, error: dateError };
  if (!deps.duffelToken && !deps.stays) return { ok: false, error: HOTEL_UNAVAILABLE };

  try {
    const places = placeClient(deps);
    const query = input.destination.trim();
    const suggestions = await places.suggest(query);
    const iata = /^[A-Za-z]{3}$/.test(query) ? query.toUpperCase() : undefined;
    const located = stayAreaForPlace({ label: query, iata }, suggestions);
    if (!located) return { ok: false, error: `I couldn't find a stay area for ${query}.` };

    const stays = deps.stays ?? createDuffelStays({ token: deps.duffelToken!, fetchImpl: deps.fetchImpl });
    const cards = await stays.search({
      lat: located.lat,
      lng: located.lng,
      radiusKm: located.radiusKm,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: input.guests,
      rooms: input.rooms,
    });
    const hotels = cards.slice(0, MAX_HOTELS).map(toHotel);
    const area: StayArea = { label: stayLabel(query, iata, suggestions), lat: located.lat, lng: located.lng };
    if (hotels.length === 0) return { ok: true, hotels: [], note: "No hotels matched that search.", area };
    return { ok: true, hotels, area };
  } catch {
    return { ok: false, error: HOTEL_UNAVAILABLE };
  }
}

/** Resolves a preferred stay area through Duffel places. No prices. */
export async function noteStayArea(place: string, deps: SearchDeps): Promise<StayAreaResult> {
  if (!deps.duffelToken && !deps.places) return { ok: false, error: HOTEL_UNAVAILABLE };
  try {
    const resolved = await resolvePlace(place, placeClient(deps), "hotel");
    if (!resolved.ok) return resolved;
    if (resolved.place.lat == null || resolved.place.lng == null) {
      return { ok: false, error: `I couldn't find coordinates for ${resolved.place.name}.` };
    }
    return { ok: true, label: resolved.place.name, lat: resolved.place.lat, lng: resolved.place.lng };
  } catch {
    return { ok: false, error: HOTEL_UNAVAILABLE };
  }
}

function stayLabel(query: string, iata: string | undefined, suggestions: PlaceSuggestion[]): string {
  const named = suggestions.find((item) => item.kind === "city" && item.name.toLowerCase() === query.toLowerCase());
  if (named) return named.name;
  const coded = iata
    ? suggestions.find((item) => item.kind === "city" && item.iataCode.toUpperCase() === iata)
    : undefined;
  return coded?.name ?? query;
}

function placeClient(deps: SearchDeps): PlaceSuggestionsProvider {
  if (deps.places) return deps.places;
  if (!deps.duffelToken) {
    return { async suggest() { return []; } };
  }
  return createDuffelPlaceSuggestions({ token: deps.duffelToken, fetchImpl: deps.fetchImpl });
}

async function resolvePlace(
  query: string,
  places: PlaceSuggestionsProvider,
  kind: "flight" | "hotel",
): Promise<{ ok: true; place: PlaceSuggestion } | { ok: false; error: string }> {
  const trimmed = query.trim();
  if (kind === "flight" && /^[A-Za-z]{3}$/.test(trimmed)) {
    return {
      ok: true,
      place: {
        kind: "airport",
        name: trimmed.toUpperCase(),
        iataCode: trimmed.toUpperCase(),
        airports: [],
        lat: null,
        lng: null,
      },
    };
  }

  const suggestions = await places.suggest(trimmed);
  const cities = suggestions.filter((item) => item.kind === "city");
  const city = cities[0];
  if (cities.length === 1 && city) return { ok: true, place: city };
  if (cities.length > 1) return { ok: false, error: ambiguous(cities) };
  const only = suggestions[0];
  if (suggestions.length === 1 && only) return { ok: true, place: only };
  if (suggestions.length === 0) return { ok: false, error: `I couldn't find "${trimmed}". Try a city or airport code.` };
  return { ok: false, error: ambiguous(suggestions) };
}

function ambiguous(places: PlaceSuggestion[]): string {
  const list = places.slice(0, 5).map((place) => `${place.name} (${place.iataCode})`).join(", ");
  return `Which place did you mean: ${list}?`;
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

function toHotel(card: StayCard): HotelOffer {
  return {
    id: card.id,
    name: card.name,
    image: card.image,
    ...(card.area ? { location: card.area } : {}),
    pricePerNight: card.nightlyAmount,
    totalPrice: card.totalAmount ?? null,
    currency: card.currency,
    rating: card.guestScore,
    amenities: card.amenities ?? [],
  };
}
