export interface FlightSearchInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  travelers: number;
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
  nonstop?: boolean;
  departureTimeFrom?: string;
  departureTimeTo?: string;
  /** Matched against the offer owner after Duffel responds. Not sent as a request filter. */
  airline?: string;
}

/** Fields taken from a Duffel offer. Per-person `price` is `total_amount` divided by the travelers we requested. */
export interface FlightOffer {
  airline: string;
  flightNumber?: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration?: string;
  stops: number;
  price: number;
  totalPrice: number;
  currency: string;
  returnDepartureTime?: string;
  returnArrivalTime?: string;
}

export interface FlightSearchResult {
  flights: FlightOffer[];
  note?: string;
}

export interface FlightsProvider {
  search(input: FlightSearchInput): Promise<FlightSearchResult>;
}
