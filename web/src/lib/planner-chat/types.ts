import type { FlightOffer } from "@/lib/providers/flights/types";

export interface HotelOffer {
  /** Sample stay id, so a chat pick matches the same stay in browse. */
  id?: string;
  name: string;
  location?: string;
  image?: string | null;
  pricePerNight: number | null;
  totalPrice: number | null;
  currency: string | null;
  /** Sample guest score, when the stay has one. */
  rating: number | null;
  amenities: string[];
}

export interface PlannerChatResult {
  text: string;
  flights: FlightOffer[];
  hotels: HotelOffer[];
}

export const FLIGHT_UNAVAILABLE = "I couldn't retrieve flight options right now. Try again in a moment.";
export const HOTEL_UNAVAILABLE = "I couldn't retrieve hotel options right now. Try again in a moment.";
export const CHAT_UNAVAILABLE = "Trip chat isn't available right now. Try again in a moment.";
export const CHAT_BUSY = "The trip agent is busy right now. Try again in a moment.";
export const CHAT_TIMEOUT = "I couldn't look that up right now. Try again in a moment.";

export interface StayArea {
  label: string;
  lat: number;
  lng: number;
}

export type PlannerChatEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "clarify" }
  | { type: "cards"; flights: FlightOffer[]; hotels: HotelOffer[]; commit?: boolean }
  | { type: "stayArea"; label: string; lat: number; lng: number }
  | { type: "error"; message: string }
  | { type: "done" };
