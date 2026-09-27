import type { FlightOffer } from "@/lib/providers/flights/types";
import type { HotelOffer } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHEAPER = /\b(cheap|cheaper|price|prices|budget|save|money|cost)\b/i;
const FASTER = /\b(time|faster|fast|nonstop|non-stop|direct|quick|shorter)\b/i;
const SCORE = /\b(review|reviews|rating|score|rated)\b/i;

export type ClarifyTrip = {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  budget?: number | null;
};

export type ClarifyInput = {
  fromQuestionnaire: boolean;
  clarifyCount: number;
  trip?: ClarifyTrip;
  /** User texts in order. The first opens the thread; later ones answer questions. */
  userTexts: string[];
  searched: boolean;
  flights: FlightOffer[];
  hotels: HotelOffer[];
};

export type ClarifyDecision =
  | { action: "ask"; text: string }
  | { action: "search" }
  | { action: "chat" }
  | { action: "commit"; text: string; flight?: FlightOffer; hotel?: HotelOffer };

type Gap = "destination" | "origin" | "dates" | "budget";
type FlightPair = { faster: FlightOffer; cheaper: FlightOffer };
type HotelPair = { rated: HotelOffer; cheaper: HotelOffer };

/** Asks from real catalog tradeoffs, then commits to one flight and one hotel. */
export function decideClarification(input: ClarifyInput): ClarifyDecision {
  const gap = missingBaseline(input.trip);
  if (!input.fromQuestionnaire && input.clarifyCount === 0 && gap) {
    return { action: "ask", text: baselineQuestion(gap) };
  }
  if (!input.searched) {
    return canSearch(input.trip) ? { action: "search" } : { action: "chat" };
  }

  const flights = input.flights.slice(0, 4);
  const hotels = input.hotels.slice(0, 4);
  const questions = narrowingQuestions(flights, hotels);
  const offset = !input.fromQuestionnaire && gap ? 1 : 0;
  const narrowingAsked = Math.max(0, input.clarifyCount - offset);
  const cap = input.fromQuestionnaire ? 2 : 3;
  const answers = input.userTexts.slice(1);
  const flight = chooseFlight(flights, answers, questions, offset);
  const hotel = chooseHotel(hotels, answers, questions, offset);

  if (input.clarifyCount >= cap || narrowingAsked >= questions.length) {
    return { action: "commit", text: recommendationText(flight, hotel), flight, hotel };
  }

  const next = questions[narrowingAsked];
  if (next === "flight") {
    const pair = flightTradeoff(flights);
    return { action: "ask", text: pair ? flightQuestion(pair) : recommendationText(flight, hotel) };
  }
  const pair = hotelTradeoff(hotels);
  return { action: "ask", text: pair ? hotelQuestion(pair) : recommendationText(flight, hotel) };
}

function narrowingQuestions(flights: FlightOffer[], hotels: HotelOffer[]): Array<"flight" | "hotel"> {
  const questions: Array<"flight" | "hotel"> = [];
  if (flightTradeoff(flights)) questions.push("flight");
  if (hotelTradeoff(hotels)) questions.push("hotel");
  return questions;
}

function missingBaseline(trip: ClarifyTrip | undefined): Gap | null {
  if ((trip?.destination?.trim().length ?? 0) < 2) return "destination";
  if ((trip?.origin?.trim().length ?? 0) < 2) return "origin";
  if (!ISO_DATE.test(trip?.startDate?.trim() ?? "")) return "dates";
  if (trip?.budget == null || trip.budget <= 0) return "budget";
  return null;
}

function canSearch(trip: ClarifyTrip | undefined): boolean {
  return (
    (trip?.origin?.trim().length ?? 0) >= 2 &&
    (trip?.destination?.trim().length ?? 0) >= 2 &&
    ISO_DATE.test(trip?.startDate?.trim() ?? "")
  );
}

function baselineQuestion(gap: Gap): string {
  if (gap === "destination") return "Where should the group go?";
  if (gap === "origin") return "Where are you flying from?";
  if (gap === "dates") return "What dates are you traveling?";
  return "What's the budget per person?";
}

function flightTradeoff(flights: FlightOffer[]): FlightPair | null {
  const nonstop = cheapest(flights.filter((flight) => flight.stops === 0));
  const connection = cheapest(flights.filter((flight) => flight.stops > 0));
  if (nonstop && connection && connection.price < nonstop.price) {
    return { faster: nonstop, cheaper: connection };
  }
  const low = cheapest(flights);
  const fast = [...flights].sort((a, b) => durationMinutes(a) - durationMinutes(b) || a.price - b.price)[0];
  if (low && fast && !sameFlight(low, fast) && low.price < fast.price) return { faster: fast, cheaper: low };
  return null;
}

function hotelTradeoff(hotels: HotelOffer[]): HotelPair | null {
  if (hotels.length < 2) return null;
  const rated = [...hotels].sort((a, b) => {
    const rating = (b.rating ?? -1) - (a.rating ?? -1);
    if (rating !== 0) return rating;
    return (a.pricePerNight ?? Number.POSITIVE_INFINITY) - (b.pricePerNight ?? Number.POSITIVE_INFINITY);
  })[0];
  const lower = cheapestHotel(hotels);
  if (!rated || !lower || rated.name === lower.name) return null;
  if (rated.pricePerNight === lower.pricePerNight && rated.rating === lower.rating) return null;
  return { rated, cheaper: lower };
}

function chooseFlight(
  flights: FlightOffer[],
  answers: string[],
  questions: Array<"flight" | "hotel">,
  offset: number,
): FlightOffer | undefined {
  const fallback = cheapest(flights.filter((flight) => flight.stops === 0)) ?? cheapest(flights);
  const pair = flightTradeoff(flights);
  const index = questions.indexOf("flight");
  if (!pair || index < 0) return fallback;
  const answer = answers[offset + index] ?? "";
  const named = flights.find((flight) => answer.toLowerCase().includes(flight.airline.toLowerCase()));
  if (CHEAPER.test(answer) && !FASTER.test(answer)) return pair.cheaper;
  if (FASTER.test(answer)) return pair.faster;
  if (named) return named;
  return fallback;
}

function chooseHotel(
  hotels: HotelOffer[],
  answers: string[],
  questions: Array<"flight" | "hotel">,
  offset: number,
): HotelOffer | undefined {
  const pair = hotelTradeoff(hotels);
  const fallback = [...hotels].sort((a, b) => {
    const rating = (b.rating ?? -1) - (a.rating ?? -1);
    if (rating !== 0) return rating;
    return (a.pricePerNight ?? Number.POSITIVE_INFINITY) - (b.pricePerNight ?? Number.POSITIVE_INFINITY);
  })[0];
  const index = questions.indexOf("hotel");
  if (!pair || index < 0) return fallback;
  const answer = answers[offset + index] ?? "";
  const named = hotels.find((hotel) => {
    const haystack = answer.toLowerCase();
    return haystack.includes(hotel.name.toLowerCase()) || (hotel.location ? haystack.includes(hotel.location.toLowerCase()) : false);
  });
  if (SCORE.test(answer) && !CHEAPER.test(answer)) return pair.rated;
  if (CHEAPER.test(answer)) return pair.cheaper;
  if (named) return named;
  return fallback;
}

function flightQuestion(pair: FlightPair): string {
  const fasterKind = pair.faster.stops === 0 ? "nonstop" : stopPhrase(pair.faster.stops);
  const cheaperKind = pair.cheaper.stops === 0 ? "nonstop" : stopPhrase(pair.cheaper.stops);
  const gap = pair.faster.price - pair.cheaper.price;
  return `I found a ${fasterKind} ${pair.faster.airline} for ${money(pair.faster.currency, pair.faster.price)} and a ${pair.cheaper.airline} fare for ${money(pair.cheaper.currency, pair.cheaper.price)} ${cheaperKind} — ${money(pair.cheaper.currency, gap)} less. Which matters more, price or time?`;
}

function hotelQuestion(pair: HotelPair): string {
  return `Two solid stays: ${stayBits(pair.rated)}, and ${stayBits(pair.cheaper)}. Which do you care about more, the guest score or the price?`;
}

function stayBits(hotel: HotelOffer): string {
  const where = hotel.location ? ` in ${hotel.location}` : "";
  const nightly = hotel.pricePerNight != null ? ` is ${money(hotel.currency, hotel.pricePerNight)} a night` : "";
  const score = hotel.rating != null ? ` with a ${hotel.rating} guest score` : "";
  return `${hotel.name}${where}${nightly}${score}`;
}

function recommendationText(flight?: FlightOffer, hotel?: HotelOffer): string {
  const picks = [flight ? flightLabel(flight) : "", hotel?.name ?? ""].filter(Boolean);
  if (picks.length === 0) return "Nothing in the sample catalog matched that search.";
  const why = [flight ? flightWhy(flight) : "", hotel ? hotelWhy(hotel) : ""].filter(Boolean);
  return `Based on that, I'd go with ${picks.join(" and ")}. ${why.join(", and ")}.`;
}

function flightLabel(flight: FlightOffer): string {
  const kind = flight.stops === 0 ? "nonstop " : "";
  return `the ${kind}${flight.airline} flight`;
}

function flightWhy(flight: FlightOffer): string {
  const when = clock(flight.departureTime);
  const stops = flight.stops === 0 ? "nonstop" : stopPhrase(flight.stops);
  return `${flight.airline} is ${money(flight.currency, flight.price)}${when ? ` and leaves at ${when}` : ""} ${stops}`;
}

function hotelWhy(hotel: HotelOffer): string {
  const where = hotel.location ? ` in ${hotel.location}` : "";
  const nightly = hotel.pricePerNight != null ? ` for ${money(hotel.currency, hotel.pricePerNight)} a night` : "";
  const score = hotel.rating != null ? ` with a ${hotel.rating} guest score` : "";
  return `${hotel.name}${where}${nightly}${score}`;
}

function stopPhrase(stops: number): string {
  if (stops === 1) return "with a layover";
  return `with ${stops} stops`;
}

function cheapest(flights: FlightOffer[]): FlightOffer | undefined {
  return [...flights].sort((a, b) => a.price - b.price)[0];
}

function cheapestHotel(hotels: HotelOffer[]): HotelOffer | undefined {
  return [...hotels].sort(
    (a, b) => (a.pricePerNight ?? Number.POSITIVE_INFINITY) - (b.pricePerNight ?? Number.POSITIVE_INFINITY),
  )[0];
}

function sameFlight(a: FlightOffer, b: FlightOffer): boolean {
  return a.airline === b.airline && a.price === b.price && a.departureTime === b.departureTime;
}

function durationMinutes(flight: FlightOffer): number {
  const match = /(\d+)h(?:\s*(\d+)m)?|(\d+)m/.exec(flight.duration ?? "");
  if (!match) return flight.stops * 10_000;
  if (match[3]) return Number(match[3]);
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

function clock(value: string | undefined): string {
  return value ? (/T(\d{2}:\d{2})/.exec(value)?.[1] ?? "") : "";
}

function money(currency: string | null | undefined, amount: number): string {
  const code = (currency ?? "USD").toUpperCase();
  const rounded = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  if (code === "USD") return `$${rounded}`;
  if (code === "EUR") return `€${rounded}`;
  if (code === "GBP") return `£${rounded}`;
  return `${rounded} ${code}`;
}
