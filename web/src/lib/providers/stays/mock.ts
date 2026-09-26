import { DESTINATIONS, staysFor, type Destination, type StayOption } from "@/features/trip-draft/fixtures";
import type {
  StayAccommodation,
  StayCard,
  StayRates,
  StaysProvider,
} from "./types";

const AMENITIES = [
  { type: "wifi", description: "Wi-Fi" },
  { type: "kitchen", description: "Kitchen" },
  { type: "parking", description: "Parking" },
];

export function stayCardsForDestination(destinationId: string | null): StayCard[] {
  return staysFor(destinationId).map((stay) => ({
    id: stay.id,
    name: stay.name,
    image: stay.image,
    area: stay.neighborhood,
    guestScore: stay.rating,
    reviewCount: stay.reviews,
    starRating: null,
    nightlyAmount: stay.price,
    currency: "USD",
  }));
}

function destinationNear(lat: number, lng: number): Destination | null {
  let best: Destination | null = null;
  let bestDistance = Infinity;
  for (const destination of DESTINATIONS) {
    const distance = Math.hypot(destination.lat - lat, destination.lng - lng);
    if (distance < bestDistance) {
      best = destination;
      bestDistance = distance;
    }
  }
  return bestDistance < 0.5 ? best : null;
}

function fixtureStay(id: string): { stay: StayOption; destination: Destination } | null {
  for (const destination of DESTINATIONS) {
    const stay = staysFor(destination.id).find((item) => item.id === id);
    if (stay) return { stay, destination };
  }
  return null;
}

function nights(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T12:00:00`) - Date.parse(`${checkIn}T12:00:00`);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.round(ms / 86_400_000);
}

function toAccommodation(stay: StayOption, destination: Destination): StayAccommodation {
  return {
    id: stay.id,
    name: stay.name,
    description: `${stay.name} in ${stay.neighborhood}, ${destination.label}.`,
    photos: [{ url: stay.image }],
    amenities: AMENITIES,
    address: {
      lineOne: null,
      cityName: destination.label,
      region: stay.neighborhood,
      postalCode: null,
      countryCode: null,
    },
    lat: destination.lat,
    lng: destination.lng,
    guestScore: stay.rating,
    reviewCount: stay.reviews,
    starRating: null,
    brandName: null,
    chainName: null,
    checkInAfter: "15:00",
    checkOutBefore: "11:00",
  };
}

export const mockStaysProvider: StaysProvider = {
  async search(input) {
    const destination = destinationNear(input.lat, input.lng);
    if (!destination) return [];
    return stayCardsForDestination(destination.id);
  },

  async getAccommodation(id) {
    const found = fixtureStay(id);
    if (!found) return null;
    return toAccommodation(found.stay, found.destination);
  },

  async getRates(input) {
    const found = fixtureStay(input.accommodationId);
    if (!found) return null;
    const total = (found.stay.price * nights(input.checkIn, input.checkOut)).toFixed(2);
    return {
      searchResultId: `srr_${found.stay.id}`,
      totalAmount: total,
      currency: "USD",
      rooms: [
        {
          name: found.stay.name,
          beds: [{ type: "double", count: 1 }],
          photos: [{ url: found.stay.image }],
          rateName: "Standard rate",
          totalAmount: total,
          currency: "USD",
          boardType: "room_only",
          paymentType: "pay_now",
          cancellationTimeline: [],
        },
      ],
    } satisfies StayRates;
  },

  async getReviews() {
    return [];
  },
};
