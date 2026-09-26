/**
 * Trip-draft inventory. The same document is stored in `demo_catalog` so the database and
 * these screens share one list. Fares are round-trip display dollars from New York, not a charge.
 * Lookups: `destinationById`, `matchDestination`, `flightsFor`, `staysFor`, `findFlight`, `findStay`, `chatCityDestination`.
 */
import catalog from "./city-catalog.json";
export type Destination = {
  id: string;
  label: string;
  country: string;
  code: string;
  lng: number;
  lat: number;
  blurb: string;
  photos: [string, string, string];
};

export type FlightOption = {
  id: string;
  destinationId: string;
  airline: string;
  from: "JFK";
  to: string;
  depart: string;
  arrive: string;
  duration: string;
  stops: string;
  price: number;
  image: string;
};

export type StayOption = {
  id: string;
  destinationId: string;
  name: string;
  neighborhood: string;
  rating: number;
  reviews: number;
  price: number;
  image: string;
};

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=80`;

const PLANES = [
  photo("photo-1436491865332-7a61a109cc05"),
  photo("photo-1464037866556-6812c9d1c72e"),
  photo("photo-1569154941061-e231b4725ef1"),
];

type FlightSeed = Omit<FlightOption, "id" | "destinationId" | "from" | "to" | "image">;
type StaySeed = Omit<StayOption, "id" | "destinationId" | "image">;

export const DESTINATIONS: Destination[] = catalog.destinations.map((destination) => ({
  ...destination,
  photos: destination.photos.map((id) => photo(id)) as [string, string, string],
}));

const FLIGHTS: Record<string, FlightSeed[]> = catalog.flights;

const STAYS: Record<string, StaySeed[]> = catalog.stays;

export const DIETARY = ["None", "Vegetarian", "Vegan", "Gluten-free", "Halal", "Kosher"] as const;

export const VIBES = ["Food", "Nightlife", "Museums", "Outdoors", "Beach", "Design", "Slow mornings"] as const;

export const BUDGETS = [150, 300, 500, 800] as const;

export function destinationById(id: string | null | undefined): Destination | null {
  if (!id) return null;
  return DESTINATIONS.find((destination) => destination.id === id) ?? null;
}

export function matchDestination(query: string): Destination | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  const ranked = DESTINATIONS.flatMap((destination) => {
    const label = destination.label.toLowerCase();
    const country = destination.country.toLowerCase();
    if (label === q) return [{ destination, score: 0 }];
    if (label.startsWith(q)) return [{ destination, score: 1 }];
    if (country.startsWith(q)) return [{ destination, score: 2 }];
    if (label.includes(q)) return [{ destination, score: 3 }];
    return [];
  }).sort((a, b) => a.score - b.score);
  return ranked[0]?.destination ?? null;
}

export function flightsFor(destinationId: string | null): FlightOption[] {
  const destination = destinationById(destinationId);
  if (!destination) return [];
  return (FLIGHTS[destination.id] ?? []).map((seed, index) => ({
    ...seed,
    id: `${destination.id}-flight-${index}`,
    destinationId: destination.id,
    from: "JFK" as const,
    to: destination.code,
    image: PLANES[index % PLANES.length],
  }));
}

export function staysFor(destinationId: string | null): StayOption[] {
  const destination = destinationById(destinationId);
  if (!destination) return [];
  return (STAYS[destination.id] ?? []).map((seed, index) => ({
    ...seed,
    id: `${destination.id}-stay-${index}`,
    destinationId: destination.id,
    image: destination.photos[index] ?? destination.photos[0],
  }));
}

export function findFlight(destinationId: string | null, flightId: string | null): FlightOption | null {
  if (!flightId) return null;
  return flightsFor(destinationId).find((flight) => flight.id === flightId) ?? null;
}

export function findStay(destinationId: string | null, stayId: string | null): StayOption | null {
  if (!stayId) return null;
  return staysFor(destinationId).find((stay) => stay.id === stayId) ?? null;
}

/**
 * Chat city-detect for the studio shell. Returns the matched destination when the
 * message names a new city, else null. Pure wrapper over matchDestination so the
 * studio can confirm it (which drops the map pin) without duplicating matching.
 */
export function chatCityDestination(text: string, currentId: string | null): Destination | null {
  const match = matchDestination(text);
  if (!match || match.id === currentId) return null;
  return match;
}
