import type { FlightOffer } from "@/lib/providers/flights/types";
import type { HotelOffer } from "./types";

export const SAFE_LINE = "Take the earliest nonstop and stay at the best-rated hotel in the city center.";
export const RETRY_INSTRUCTION =
  "Recommend from tool results only. No price, time, airline, or hotel name unless a tool returned it. Search with the trip draft, then name one flight and one hotel.";

const AIRLINES =
  /\b(delta|united|american airlines|jetblue|southwest|lufthansa|british airways|air france|emirates|qatar airways|spirit|frontier|alaska airlines)\b/gi;
const STAR = /\b(\d(?:\.\d)?)\s?-?\s?stars?\b/gi;
const PER_NIGHT = /\b(?:per night|a night|\/\s*night)\b/i;
const TITLE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\b/g;
const ALLOWED_PHRASES = new Set(["good morning", "thank you", "let me"]);

export type ReplyDecision = { action: "send"; text: string } | { action: "retry" };

export function mentionsTravelFact(text: string): boolean {
  return (
    pricesIn(text).length > 0 ||
    timesIn(text).length > 0 ||
    flightNumbersIn(text).length > 0 ||
    airlinesIn(text).length > 0 ||
    starRatingsIn(text).length > 0 ||
    PER_NIGHT.test(text)
  );
}

/** A reply with no catalog search may pass through. A fact with no search is a retry. After a search, the reply recommends from the payload. */
export function decideReply(
  text: string,
  searched: boolean,
  flights: FlightOffer[],
  hotels: HotelOffer[],
): ReplyDecision {
  const trimmed = text.trim();
  if (!searched) {
    return mentionsTravelFact(trimmed) ? { action: "retry" } : { action: "send", text: trimmed };
  }
  const recommendation = offerRecommendation(flights, hotels);
  if (!trimmed || !factsAreGrounded(trimmed, flights, hotels)) {
    return { action: "send", text: recommendation || SAFE_LINE };
  }
  return { action: "send", text: trimmed };
}

/** Cheapest nonstop (else cheapest flight) and the best-rated hotel, cited only from catalog fields. */
export function offerRecommendation(flights: FlightOffer[], hotels: HotelOffer[]): string {
  const flight = pickFlight(flights);
  const hotel = pickHotel(hotels);
  const parts: string[] = [];
  if (flight) {
    const when = clockLabel(flight.departureTime);
    const price = moneyLabel(flight.currency, flight.price);
    const number = flight.flightNumber ? ` ${flight.flightNumber}` : "";
    parts.push(
      `The pick is ${flight.airline}${number} from ${flight.origin} to ${flight.destination}${when ? ` at ${when}` : ""}${price ? ` for ${price}` : ""}.`,
    );
  }
  if (hotel) {
    const nightly = hotel.pricePerNight != null ? moneyLabel(hotel.currency, hotel.pricePerNight) : "";
    const where = hotel.location ? ` in ${hotel.location}` : "";
    parts.push(`Stay at ${hotel.name}${where}${nightly ? ` for ${nightly} a night` : ""}.`);
  }
  return parts.join(" ");
}

function pickFlight(flights: FlightOffer[]): FlightOffer | undefined {
  const nonstop = flights.filter((flight) => flight.stops === 0);
  const pool = nonstop.length > 0 ? nonstop : flights;
  return [...pool].sort((a, b) => a.price - b.price)[0];
}

function pickHotel(hotels: HotelOffer[]): HotelOffer | undefined {
  return [...hotels].sort((a, b) => {
    const rating = (b.rating ?? -1) - (a.rating ?? -1);
    if (rating !== 0) return rating;
    return (a.pricePerNight ?? Number.POSITIVE_INFINITY) - (b.pricePerNight ?? Number.POSITIVE_INFINITY);
  })[0];
}

function clockLabel(value: string | undefined): string {
  return value ? (/T(\d{2}:\d{2})/.exec(value)?.[1] ?? "") : "";
}

function moneyLabel(currency: string | null | undefined, amount: number): string {
  const code = (currency ?? "USD").toUpperCase();
  if (code === "USD") return `$${amount}`;
  if (code === "EUR") return `€${amount}`;
  if (code === "GBP") return `£${amount}`;
  return `${amount} ${code}`;
}

export function factsAreGrounded(text: string, flights: FlightOffer[], hotels: HotelOffer[]): boolean {
  const prices = new Set(payloadPrices(flights, hotels));
  if (pricesIn(text).some((price) => !prices.has(price))) return false;

  const times = new Set(payloadTimes(flights));
  if (timesIn(text).some((time) => !times.has(time))) return false;

  const numbers = payloadFlightNumbers(flights);
  if (flightNumbersIn(text).some((number) => !numbers.has(number))) return false;

  const airlineHaystack = flights.map((flight) => flight.airline.toLowerCase()).join(" ");
  if (airlinesIn(text).some((airline) => !airlineHaystack.includes(airline))) return false;

  if (starRatingsIn(text).some((rating) => !hotels.some((hotel) => hotel.rating === rating))) return false;
  if (PER_NIGHT.test(text) && !hotels.some((hotel) => hotel.pricePerNight != null)) return false;

  const haystack = payloadNames(flights, hotels);
  return titlePhrases(text).every((phrase) => ALLOWED_PHRASES.has(phrase) || haystack.includes(phrase));
}

function pricesIn(text: string): number[] {
  const found: number[] = [];
  const re = /(?:\$|€|£)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP|dollars)\b/gi;
  for (const match of text.matchAll(re)) {
    const value = Number((match[1] ?? match[2] ?? "").replace(/,/g, ""));
    if (Number.isFinite(value)) found.push(roundMoney(value));
  }
  return found;
}

function timesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:T|\b)(\d{1,2}):([0-5]\d)\s*([ap]m)?\b/gi)) {
    const normalized = normalizeClock(Number(match[1]), match[2]!, match[3]);
    if (normalized) found.push(normalized);
  }
  return found;
}

function flightNumbersIn(text: string): string[] {
  return [...text.matchAll(/\b([A-Z]{2})\s?(\d{2,4})\b/g)].map((match) => `${match[1]}${match[2]}`);
}

function airlinesIn(text: string): string[] {
  return [...text.matchAll(AIRLINES)].map((match) => match[1]!.toLowerCase());
}

function starRatingsIn(text: string): number[] {
  return [...text.matchAll(STAR)].map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
}

function titlePhrases(text: string): string[] {
  return [...text.matchAll(TITLE)].map((match) => match[0].toLowerCase());
}

function payloadPrices(flights: FlightOffer[], hotels: HotelOffer[]): number[] {
  return [
    ...flights.flatMap((flight) => [flight.price, flight.totalPrice]),
    ...hotels.flatMap((hotel) => [hotel.pricePerNight, hotel.totalPrice]),
  ]
    .filter((value): value is number => value != null)
    .map(roundMoney);
}

function payloadTimes(flights: FlightOffer[]): string[] {
  return flights.flatMap((flight) =>
    [flight.departureTime, flight.arrivalTime, flight.returnDepartureTime, flight.returnArrivalTime].flatMap((value) =>
      value ? timesIn(value) : [],
    ),
  );
}

function payloadFlightNumbers(flights: FlightOffer[]): Set<string> {
  return new Set(flights.flatMap((flight) => (flight.flightNumber ? flightNumbersIn(flight.flightNumber) : [])));
}

function payloadNames(flights: FlightOffer[], hotels: HotelOffer[]): string {
  return [
    ...flights.flatMap((flight) => [flight.airline, flight.origin, flight.destination, flight.flightNumber]),
    ...hotels.flatMap((hotel) => [hotel.name, hotel.location, ...hotel.amenities]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function normalizeClock(hour: number, minute: string, suffix?: string): string | null {
  if (hour > 23) return null;
  let normalized = hour;
  const meridiem = suffix?.toLowerCase();
  if (meridiem === "pm" && normalized < 12) normalized += 12;
  if (meridiem === "am" && normalized === 12) normalized = 0;
  if (normalized > 23) return null;
  return `${String(normalized).padStart(2, "0")}:${minute}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
