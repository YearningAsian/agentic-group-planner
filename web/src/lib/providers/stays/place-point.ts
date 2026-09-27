import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";
import { straightLineMeters } from "@/lib/providers/routing/distance";

const CITY_RADIUS_KM = 5;
const MIN_DERIVED_KM = 20;
const MAX_RADIUS_KM = 80;

export interface StaySearchArea {
  lat: number;
  lng: number;
  radiusKm: number;
}

interface Point {
  lat: number;
  lng: number;
  iata?: string;
}

/** Coordinates Duffel Stays can search for a trip destination such as Tokyo. */
export function stayAreaForPlace(
  query: { label?: string | null; iata?: string | null },
  suggestions: PlaceSuggestion[],
): StaySearchArea | null {
  const label = query.label?.trim() ?? "";
  const iata = query.iata?.trim().toUpperCase() ?? "";
  if (!label && !iata) return null;

  const cities = suggestions.filter((item) => item.kind === "city");
  const city =
    (iata ? cities.find((item) => item.iataCode.toUpperCase() === iata) : undefined) ??
    (label ? cities.find((item) => same(item.name, label)) : undefined);

  if (city) {
    if (city.lat != null && city.lng != null) {
      return { lat: city.lat, lng: city.lng, radiusKm: CITY_RADIUS_KM };
    }
    return areaFromPoints(pointsForCity(city, suggestions));
  }

  const airports = suggestions.filter((item) => {
    if (item.kind !== "airport" || item.lat == null || item.lng == null) return false;
    if (iata && item.iataCode.toUpperCase() === iata) return true;
    if (label && item.cityName && same(item.cityName, label)) return true;
    if (label && same(item.name, label)) return true;
    return false;
  });
  return areaFromPoints(airports.map((item) => ({ lat: item.lat!, lng: item.lng!, iata: item.iataCode })));
}

function pointsForCity(city: PlaceSuggestion, suggestions: PlaceSuggestion[]): Point[] {
  const points: Point[] = [];
  const seen = new Set<string>();
  const iatas = new Set(city.airports.map((airport) => airport.iataCode.toUpperCase()));
  for (const airport of city.airports) {
    if (airport.lat == null || airport.lng == null) continue;
    addPoint(points, seen, { lat: airport.lat, lng: airport.lng, iata: airport.iataCode });
  }
  for (const item of suggestions) {
    if (item.kind !== "airport" || item.lat == null || item.lng == null) continue;
    const named = item.cityName ? same(item.cityName, city.name) : false;
    const listed = iatas.has(item.iataCode.toUpperCase());
    if (!named && !listed) continue;
    addPoint(points, seen, { lat: item.lat, lng: item.lng, iata: item.iataCode });
  }
  return points;
}

function addPoint(points: Point[], seen: Set<string>, point: Point) {
  const key = point.iata?.toUpperCase() ?? `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
  if (seen.has(key)) return;
  seen.add(key);
  points.push(point);
}

function areaFromPoints(points: Point[]): StaySearchArea | null {
  if (points.length === 0) return null;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  const farthestKm = Math.max(...points.map((point) => straightLineMeters({ lat, lng }, point) / 1000));
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(MIN_DERIVED_KM, Math.ceil(farthestKm + 10)));
  return { lat, lng, radiusKm };
}

function same(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
