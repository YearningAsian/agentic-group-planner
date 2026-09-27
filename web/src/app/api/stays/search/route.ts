import { NextResponse } from "next/server";
import { loadSampleCatalog } from "@/lib/demo/load-sample-catalog";
import {
  matchSampleDestination,
  nearestSampleDestination,
  sampleStayCards,
  type SampleCatalog,
  type SampleDestination,
} from "@/lib/demo/sample-catalog";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    const catalog = await loadSampleCatalog();
    const destination = locate(catalog, params);
    return NextResponse.json({ stays: sampleStayCards(catalog, destination, checkIn, checkOut) });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}

function locate(catalog: SampleCatalog, params: URLSearchParams): SampleDestination {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (params.has("lat") || params.has("lng")) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new AppError("invalid_input", "That stay area isn't a place I can search.");
    }
    const near = nearestSampleDestination(catalog, lat, lng);
    if (near) return near;
  }
  const byId = catalog.destinations.find((destination) => destination.id === params.get("destinationId"));
  if (byId) return byId;
  const label = params.get("place")?.trim() || params.get("label")?.trim() || params.get("iata")?.trim() || "";
  const named = label ? matchSampleDestination(catalog, label) : null;
  if (named) return named;
  if (!params.get("destinationId") && !label && !params.has("lat")) {
    throw new AppError("invalid_input", "Pick a destination first.");
  }
  throw new AppError("invalid_input", "That stay area isn't a place I can search.");
}
