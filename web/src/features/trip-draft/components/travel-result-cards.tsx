import type { FlightOffer } from "@/lib/providers/flights/types";
import { flightOfferId } from "@/features/trip-draft/chosen-travel";
import { formatMoney } from "@/features/trip-draft/format";
import type { HotelOffer } from "@/lib/planner-chat/types";

export function FlightResultCards({
  flights,
  selectedId,
  onChoose,
}: {
  flights: FlightOffer[];
  selectedId?: string | null;
  onChoose?: (flight: FlightOffer) => void;
}) {
  if (flights.length === 0) return null;
  return (
    <ul className="space-y-2">
      {flights.map((flight, index) => {
        const leave = clock(flight.departureTime);
        const arrive = clock(flight.arrivalTime);
        const retLeave = flight.returnDepartureTime ? clock(flight.returnDepartureTime) : null;
        const retArrive = flight.returnArrivalTime ? clock(flight.returnArrivalTime) : null;
        const id = flightOfferId(flight);
        const selected = selectedId === id;
        return (
          <li key={flightCardKey(flight, index)} className="rounded-[14px] border border-line px-4 py-3">
            <p className="text-[13px] font-bold">{flight.airline}</p>
            <p className="mt-1 text-[13.5px] font-semibold">
              {flight.origin} → {flight.destination}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {leave.date}
              {flight.flightNumber ? ` · ${flight.flightNumber}` : ""}
            </p>
            <p className="text-[13px]">
              {leave.time} → {arrive.time}
            </p>
            <p className="text-[12.5px] text-muted">
              {stopLabel(flight.stops)}
              {flight.duration ? ` · ${formatDuration(flight.duration)}` : ""}
            </p>
            <p className="mt-1 text-[15px] font-semibold tabular-nums">
              {formatMoney(flight.price, flight.currency, fractionDigits(flight.price))}
              <span className="text-[12.5px] font-medium text-muted"> / person</span>
            </p>
            {retLeave && retArrive ? (
              <p className="mt-1 text-[12.5px] text-muted">
                Return {retLeave.date} · {retLeave.time} → {retArrive.time}
              </p>
            ) : null}
            {onChoose ? (
              <button
                type="button"
                aria-label={selected ? `${flight.airline} is on your summary` : `Choose this flight: ${flight.airline}`}
                disabled={selected}
                onClick={() => onChoose(flight)}
                className="mt-3 h-9 w-full rounded-[9px] bg-accent px-3 text-[12.5px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:translate-y-px disabled:opacity-70"
              >
                {selected ? "On your summary" : "Choose this flight"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function HotelResultCards({
  hotels,
  selectedId,
  onChoose,
}: {
  hotels: HotelOffer[];
  selectedId?: string | null;
  onChoose?: (hotel: HotelOffer) => void;
}) {
  if (hotels.length === 0) return null;
  return (
    <ul className="space-y-2">
      {hotels.map((hotel) => {
        const selected = Boolean(hotel.id) && selectedId === hotel.id;
        return (
          <li key={`${hotel.id ?? hotel.name}-${hotel.location ?? ""}`} className="rounded-[14px] border border-line px-4 py-3">
          <p className="text-[13.5px] font-bold">{hotel.name}</p>
          {hotel.location ? <p className="mt-1 text-[12.5px] text-muted">{hotel.location}</p> : null}
          {hotel.pricePerNight != null && hotel.currency ? (
            <p className="mt-1 text-[15px] font-semibold tabular-nums">
              {formatMoney(hotel.pricePerNight, hotel.currency, fractionDigits(hotel.pricePerNight))}
              <span className="text-[12.5px] font-medium text-muted"> / night</span>
            </p>
          ) : null}
          {hotel.totalPrice != null && hotel.currency ? (
            <p className="text-[12.5px] text-muted">
              {formatMoney(hotel.totalPrice, hotel.currency, fractionDigits(hotel.totalPrice))} total
            </p>
          ) : null}
          {hotel.rating != null ? <p className="text-[12.5px]">{formatScore(hotel.rating)} guest score</p> : null}
          {hotel.amenities.length > 0 ? <p className="text-[12.5px] text-muted">{hotel.amenities.slice(0, 4).join(" · ")}</p> : null}
          {onChoose && hotel.id ? (
            <button
              type="button"
              aria-label={selected ? `${hotel.name} is on your summary` : `Choose this hotel: ${hotel.name}`}
              disabled={selected}
              onClick={() => onChoose(hotel)}
              className="mt-3 h-9 w-full rounded-[9px] bg-accent px-3 text-[12.5px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:translate-y-px disabled:opacity-70"
            >
              {selected ? "On your summary" : "Choose this hotel"}
            </button>
          ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function flightCardKey(flight: FlightOffer, index: number): string {
  return [
    index,
    flight.flightNumber ?? flight.airline,
    flight.departureTime,
    flight.arrivalTime,
    flight.returnDepartureTime ?? "",
    flight.returnArrivalTime ?? "",
    flight.price,
    flight.currency,
  ].join("|");
}

function fractionDigits(amount: number): number {
  return Number.isInteger(amount) ? 0 : 2;
}

function formatScore(score: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(score);
}

function stopLabel(stops: number): string {
  if (stops <= 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
}

function formatDuration(value: string): string {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value);
  if (!match) return value;
  const hours = match[1] ? `${Number(match[1])}h` : "";
  const minutes = match[2] ? `${Number(match[2])}m` : "";
  return [hours, minutes].filter(Boolean).join(" ") || value;
}

function clock(value: string): { date: string; time: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return { date: value, time: value };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day, hour, minute)),
  );
  return { date, time };
}
