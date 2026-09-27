import { NextResponse } from "next/server";
import { destinationById } from "@/lib/demo/trip-draft-fixtures";
import { getServerEnv } from "@/lib/env/server";
import { createDuffelPlaceSuggestions } from "@/lib/providers/place-suggestions";
import { createDuffelStays, stayAreaForPlace, type StaySearchArea } from "@/lib/providers/stays";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PIN_RADIUS_KM = 5;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const checkIn = params.get("checkIn") ?? "";
    const checkOut = params.get("checkOut") ?? "";
    const adults = Number(params.get("adults") ?? "1");
    if (!DATE.test(checkIn) || !DATE.test(checkOut) || checkOut <= checkIn) {
      throw new AppError("invalid_input", "Add trip dates to browse stays.");
    }
    if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
      throw new AppError("invalid_input", "Guest count must be between 1 and 9.");
    }
    const token = getServerEnv().DUFFEL_ACCESS_TOKEN;
    if (!token) throw new AppError("provider_unavailable", "Stays are unavailable right now.");
    const { lat, lng, radiusKm } = await locate(params, token);
    const stays = await createDuffelStays({ token })
      .search({
        lat,
        lng,
        radiusKm,
        checkIn,
        checkOut,
        adults,
      })
      .catch((error: unknown) => {
        if (error instanceof AppError) throw error;
        throw new AppError("provider_unavailable", "Stays are unavailable right now.", { cause: error });
      });
    return NextResponse.json({ stays });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}

async function locate(params: URLSearchParams, token: string): Promise<StaySearchArea> {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (params.has("lat") || params.has("lng")) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new AppError("invalid_input", "That stay area isn't a place I can search.");
    }
    return { lat, lng, radiusKm: PIN_RADIUS_KM };
  }
  const destination = destinationById(params.get("destinationId"));
  if (destination) return { lat: destination.lat, lng: destination.lng, radiusKm: PIN_RADIUS_KM };
  const label = params.get("place")?.trim() ?? "";
  const iata = params.get("iata")?.trim() ?? "";
  if (!label && !iata) throw new AppError("invalid_input", "Pick a destination first.");
  const suggestions = await createDuffelPlaceSuggestions({ token })
    .suggest(label || iata)
    .catch((error: unknown) => {
      throw new AppError("provider_unavailable", "Stays are unavailable right now.", { cause: error });
    });
  const area = stayAreaForPlace({ label, iata }, suggestions);
  if (!area) throw new AppError("invalid_input", "That stay area isn't a place I can search.");
  return area;
}
