/**
 * Sample city, fare, and stay document shared by the planner chat and the studio browse.
 * The same JSON is stored in `demo_catalog` (`id = cities`). Fares are round-trip display
 * dollars from New York.
 */
import catalog from "./city-catalog.json";
import type { FlightOffer } from "@/lib/providers/flights/types";
import type { StayCard } from "@/lib/providers/stays/types";
import type { HotelOffer } from "@/lib/planner-chat/types";

export interface SampleDestination {
  id: string;
  label: string;
  country: string;
  code: string;
  lng: number;
  lat: number;
  photos: string[];
}

export interface SampleFlight {
  airline: string;
  depart: string;
  arrive: string;
  duration: string;
  stops: string;
  price: number;
}

export interface SampleStay {
  name: string;
  neighborhood: string;
  rating: number;
  reviews: number;
  price: number;
}

export interface SampleCatalog {
  destinations: SampleDestination[];
  flights: Record<string, SampleFlight[]>;
  stays: Record<string, SampleStay[]>;
}

const NYC_ORIGIN = /^(jfk|lga|ewr|nyc|ny|new york|new york city)$/i;
const NEAREST_KM = 80;

export const bundledSampleCatalog = catalog as SampleCatalog;

export function parseSampleCatalog(value: unknown): SampleCatalog | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Partial<SampleCatalog>;
  if (!Array.isArray(doc.destinations) || doc.destinations.length === 0) return null;
  if (!doc.flights || typeof doc.flights !== "object" || !doc.stays || typeof doc.stays !== "object") return null;
  return doc as SampleCatalog;
}

export function matchSampleDestination(catalog: SampleCatalog, query: string): SampleDestination | null {
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  if (q.length < 2) return null;
  if (q.length === 3) {
    const coded = catalog.destinations.find((destination) => destination.code.toLowerCase() === q);
    if (coded) return coded;
  }
  const ranked = catalog.destinations
    .flatMap((destination) => {
      const label = destination.label.toLowerCase();
      const country = destination.country.toLowerCase();
      if (label === q) return [{ destination, score: 0 }];
      if (label.startsWith(q)) return [{ destination, score: 1 }];
      if (country.startsWith(q)) return [{ destination, score: 2 }];
      if (label.includes(q)) return [{ destination, score: 3 }];
      return [];
    })
    .sort((a, b) => a.score - b.score);
  return ranked[0]?.destination ?? null;
}

export function nearestSampleDestination(catalog: SampleCatalog, lat: number, lng: number): SampleDestination | null {
  let best: { destination: SampleDestination; km: number } | null = null;
  for (const destination of catalog.destinations) {
    const km = haversineKm(lat, lng, destination.lat, destination.lng);
    if (!best || km < best.km) best = { destination, km };
  }
  if (!best || best.km > NEAREST_KM) return null;
  return best.destination;
}

export function sampleFaresFromNewYork(origin: string): boolean {
  return NYC_ORIGIN.test(origin.trim());
}

export function sampleFlightOffers(
  catalog: SampleCatalog,
  destination: SampleDestination,
  input: { departureDate: string; nonstop?: boolean; airline?: string; departureTimeFrom?: string; departureTimeTo?: string },
): FlightOffer[] {
  let rows = catalog.flights[destination.id] ?? [];
  if (input.nonstop) rows = rows.filter((row) => stopsCount(row.stops) === 0);
  if (input.airline) {
    const airline = input.airline.trim().toLowerCase();
    rows = rows.filter((row) => row.airline.toLowerCase().includes(airline));
  }
  if (input.departureTimeFrom || input.departureTimeTo) {
    rows = rows.filter((row) => {
      const clock = isoClock(row.depart, "2000-01-01").slice(11, 16);
      if (input.departureTimeFrom && clock < input.departureTimeFrom) return false;
      if (input.departureTimeTo && clock > input.departureTimeTo) return false;
      return true;
    });
  }
  return rows.map((row) => ({
    airline: row.airline,
    origin: "JFK",
    destination: destination.code,
    departureTime: isoClock(row.depart, input.departureDate),
    arrivalTime: isoClock(row.arrive.replace(/\+\d+$/, ""), input.departureDate),
    duration: row.duration,
    stops: stopsCount(row.stops),
    price: row.price,
    totalPrice: row.price,
    currency: "USD",
  }));
}

export function sampleHotelOffers(
  catalog: SampleCatalog,
  destination: SampleDestination,
  checkIn: string,
  checkOut: string,
): HotelOffer[] {
  return staysFor(catalog, destination).map((stay, index) => {
    const nights = stayNights(checkIn, checkOut);
    return {
      id: `${destination.id}-stay-${index}`,
      name: stay.name,
      location: stay.neighborhood,
      image: photo(destination.photos[index] ?? destination.photos[0] ?? ""),
      pricePerNight: stay.price,
      totalPrice: stay.price * nights,
      currency: "USD",
      rating: stay.rating,
      amenities: [],
    };
  });
}

export function sampleStayCards(
  catalog: SampleCatalog,
  destination: SampleDestination,
  checkIn: string,
  checkOut: string,
): StayCard[] {
  const nights = stayNights(checkIn, checkOut);
  return staysFor(catalog, destination).map((stay, index) => ({
    id: `${destination.id}-stay-${index}`,
    name: stay.name,
    image: photo(destination.photos[index] ?? destination.photos[0] ?? ""),
    area: stay.neighborhood,
    guestScore: stay.rating,
    reviewCount: stay.reviews,
    starRating: null,
    nightlyAmount: stay.price,
    totalAmount: stay.price * nights,
    currency: "USD",
    amenities: [],
  }));
}

function staysFor(catalog: SampleCatalog, destination: SampleDestination): SampleStay[] {
  return catalog.stays[destination.id] ?? [];
}

function photo(id: string): string | null {
  if (!id) return null;
  if (id.startsWith("https://")) return id;
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=80`;
}

function stopsCount(stops: string): number {
  if (/nonstop/i.test(stops)) return 0;
  const count = Number.parseInt(stops, 10);
  return Number.isFinite(count) ? count : 1;
}

function isoClock(display: string, date: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(display.trim());
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return display;
  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3]!.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${date}T${String(hour).padStart(2, "0")}:${minute}:00`;
}

function stayNights(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.round((end - start) / 86_400_000);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
