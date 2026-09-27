import type { FlightOffer } from "@/lib/providers/flights/types";
import type { HotelOffer } from "@/lib/planner-chat/types";

/** Same composite the plan picker uses to lock a Duffel flight. */
export function flightOfferId(flight: Pick<FlightOffer, "airline" | "origin" | "destination" | "departureTime" | "price">): string {
  return [flight.airline, flight.origin, flight.destination, flight.departureTime, String(flight.price)].join("-");
}

export type ChosenFlight = {
  id: string;
  airline: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  stops: number;
  price: number;
  currency: string;
};

export type ChosenStay = {
  id: string;
  name: string;
  area: string;
  nightlyAmount: number | null;
  currency: string | null;
  guestScore: number | null;
  image: string | null;
};

export function chosenFlightFrom(flight: FlightOffer): ChosenFlight {
  return {
    id: flightOfferId(flight),
    airline: flight.airline,
    origin: flight.origin,
    destination: flight.destination,
    departure: flight.departureTime,
    arrival: flight.arrivalTime,
    stops: flight.stops,
    price: flight.price,
    currency: flight.currency,
  };
}

export function chosenStayFromHotel(hotel: HotelOffer): ChosenStay | null {
  if (!hotel.id) return null;
  return {
    id: hotel.id,
    name: hotel.name,
    area: hotel.location ?? "",
    nightlyAmount: hotel.pricePerNight,
    currency: hotel.currency,
    guestScore: hotel.rating,
    image: hotel.image ?? null,
  };
}
