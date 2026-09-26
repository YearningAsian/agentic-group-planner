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

export const DESTINATIONS: Destination[] = [
  {
    id: "lisbon",
    label: "Lisbon",
    country: "Portugal",
    code: "LIS",
    lng: -9.1393,
    lat: 38.7223,
    blurb: "Hills, tiles, and late dinners",
    photos: [
      photo("photo-1555881400-74d7acaacd8b"),
      photo("photo-1533106497176-45ae19e68ba2"),
      photo("photo-1585208798174-6cedd86e019a"),
    ],
  },
  {
    id: "kyoto",
    label: "Kyoto",
    country: "Japan",
    code: "KIX",
    lng: 135.7681,
    lat: 35.0116,
    blurb: "Temples and quiet mornings",
    photos: [
      photo("photo-1493976040374-85c8e12f0c0e"),
      photo("photo-1524413840807-0c3cb6fa808d"),
      photo("photo-1545569341-9eb8b30979d9"),
    ],
  },
  {
    id: "mexico-city",
    label: "Mexico City",
    country: "Mexico",
    code: "MEX",
    lng: -99.1332,
    lat: 19.4326,
    blurb: "Markets, museums, and long tables",
    photos: [
      photo("photo-1518659526054-190340b32735"),
      photo("photo-1585464231875-d9ef1f5ad396"),
      photo("photo-1512813195386-6cf811ad3542"),
    ],
  },
  {
    id: "reykjavik",
    label: "Reykjavík",
    country: "Iceland",
    code: "KEF",
    lng: -21.9426,
    lat: 64.1466,
    blurb: "Pools, weather, and long light",
    photos: [
      photo("photo-1476610182048-b716b8518aae"),
      photo("photo-1504829857797-ddff29c27927"),
      photo("photo-1529963183134-61a90db47eaf"),
    ],
  },
  {
    id: "new-orleans",
    label: "New Orleans",
    country: "USA",
    code: "MSY",
    lng: -90.0715,
    lat: 29.9511,
    blurb: "Porches, music, and spice",
    photos: [
      photo("photo-1569949381669-ecf31ae8e613"),
      photo("photo-1571896349842-33c89424de2d"),
      photo("photo-1568402102990-bc541580b59f"),
    ],
  },
  {
    id: "barcelona",
    label: "Barcelona",
    country: "Spain",
    code: "BCN",
    lng: 2.1734,
    lat: 41.3851,
    blurb: "Sea, design, and late walks",
    photos: [
      photo("photo-1583422409516-2895a77efded"),
      photo("photo-1539037116277-4db20889f2d4"),
      photo("photo-1523531294919-4bcd7c65e216"),
    ],
  },
];

const FLIGHTS: Record<string, Omit<FlightOption, "id" | "destinationId" | "from" | "to" | "image">[]> = {
  lisbon: [
    { airline: "Mariner", depart: "6:20 PM", arrive: "6:35 AM+1", duration: "7h 15m", stops: "Nonstop", price: 548 },
    { airline: "Cedar Air", depart: "10:05 PM", arrive: "2:40 PM+1", duration: "11h 35m", stops: "1 stop", price: 389 },
    { airline: "Lumen", depart: "8:50 AM", arrive: "9:05 PM", duration: "7h 15m", stops: "Nonstop", price: 712 },
  ],
  kyoto: [
    { airline: "Mariner", depart: "11:10 AM", arrive: "3:45 PM+1", duration: "14h 35m", stops: "1 stop", price: 890 },
    { airline: "Cedar Air", depart: "1:20 AM", arrive: "7:55 AM+1", duration: "16h 35m", stops: "1 stop", price: 734 },
    { airline: "Lumen", depart: "9:40 AM", arrive: "6:15 PM+1", duration: "17h 35m", stops: "Nonstop", price: 1240 },
  ],
  "mexico-city": [
    { airline: "Mariner", depart: "7:15 AM", arrive: "11:40 AM", duration: "5h 25m", stops: "Nonstop", price: 286 },
    { airline: "Cedar Air", depart: "3:50 PM", arrive: "9:35 PM", duration: "6h 45m", stops: "1 stop", price: 214 },
    { airline: "Lumen", depart: "6:05 PM", arrive: "10:20 PM", duration: "5h 15m", stops: "Nonstop", price: 364 },
  ],
  reykjavik: [
    { airline: "Mariner", depart: "8:30 PM", arrive: "6:15 AM+1", duration: "5h 45m", stops: "Nonstop", price: 412 },
    { airline: "Cedar Air", depart: "5:10 PM", arrive: "6:40 AM+1", duration: "9h 30m", stops: "1 stop", price: 318 },
    { airline: "Lumen", depart: "9:55 PM", arrive: "7:30 AM+1", duration: "5h 35m", stops: "Nonstop", price: 529 },
  ],
  "new-orleans": [
    { airline: "Mariner", depart: "9:05 AM", arrive: "11:50 AM", duration: "3h 45m", stops: "Nonstop", price: 178 },
    { airline: "Cedar Air", depart: "2:25 PM", arrive: "6:40 PM", duration: "5h 15m", stops: "1 stop", price: 142 },
    { airline: "Lumen", depart: "6:40 PM", arrive: "9:20 PM", duration: "3h 40m", stops: "Nonstop", price: 246 },
  ],
  barcelona: [
    { airline: "Mariner", depart: "7:45 PM", arrive: "9:10 AM+1", duration: "7h 25m", stops: "Nonstop", price: 612 },
    { airline: "Cedar Air", depart: "11:30 PM", arrive: "4:15 PM+1", duration: "11h 45m", stops: "1 stop", price: 447 },
    { airline: "Lumen", depart: "10:20 AM", arrive: "11:55 PM", duration: "7h 35m", stops: "Nonstop", price: 804 },
  ],
};

const STAYS: Record<string, Omit<StayOption, "id" | "destinationId" | "image">[]> = {
  lisbon: [
    { name: "Alfama townhouse", neighborhood: "Alfama", rating: 4.94, reviews: 186, price: 168 },
    { name: "Tile-roof flat", neighborhood: "Baixa", rating: 4.81, reviews: 92, price: 124 },
    { name: "River-view loft", neighborhood: "Cais do Sodré", rating: 4.88, reviews: 140, price: 210 },
  ],
  kyoto: [
    { name: "Machiya with a garden", neighborhood: "Gion", rating: 4.97, reviews: 74, price: 242 },
    { name: "Lane house", neighborhood: "Higashiyama", rating: 4.86, reviews: 121, price: 176 },
    { name: "Inn near the river", neighborhood: "Pontocho", rating: 4.9, reviews: 88, price: 198 },
  ],
  "mexico-city": [
    { name: "Courtyard apartment", neighborhood: "Roma Norte", rating: 4.91, reviews: 203, price: 132 },
    { name: "Tree-lined flat", neighborhood: "Condesa", rating: 4.84, reviews: 156, price: 118 },
    { name: "Rooftop studio", neighborhood: "Juárez", rating: 4.79, reviews: 97, price: 96 },
  ],
  reykjavik: [
    { name: "Harbor cottage", neighborhood: "Grandagarður", rating: 4.93, reviews: 64, price: 228 },
    { name: "Quiet studio", neighborhood: "Miðbær", rating: 4.77, reviews: 81, price: 164 },
    { name: "House with a hot tub", neighborhood: "Vesturbær", rating: 4.96, reviews: 52, price: 286 },
  ],
  "new-orleans": [
    { name: "Shotgun cottage", neighborhood: "Marigny", rating: 4.89, reviews: 143, price: 154 },
    { name: "Balcony suite", neighborhood: "French Quarter", rating: 4.83, reviews: 210, price: 189 },
    { name: "Garden house", neighborhood: "Garden District", rating: 4.95, reviews: 77, price: 206 },
  ],
  barcelona: [
    { name: "Eixample apartment", neighborhood: "Eixample", rating: 4.9, reviews: 168, price: 176 },
    { name: "Gothic-quarter flat", neighborhood: "El Born", rating: 4.85, reviews: 134, price: 158 },
    { name: "Sea-facing rooms", neighborhood: "Barceloneta", rating: 4.8, reviews: 99, price: 194 },
  ],
};

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
