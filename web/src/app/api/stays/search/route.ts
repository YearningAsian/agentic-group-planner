import { NextResponse } from "next/server";
import { destinationById } from "@/lib/demo/trip-draft-fixtures";
import { getStaysProvider } from "@/lib/providers/stays";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RADIUS_KM = 5;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const destination = destinationById(params.get("destinationId"));
    const checkIn = params.get("checkIn") ?? "";
    const checkOut = params.get("checkOut") ?? "";
    const adults = Number(params.get("adults") ?? "1");
    if (!destination) {
      throw new AppError("invalid_input", "Pick a destination first.");
    }
    if (!DATE.test(checkIn) || !DATE.test(checkOut) || checkOut <= checkIn) {
      throw new AppError("invalid_input", "Add trip dates to browse stays.");
    }
    if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
      throw new AppError("invalid_input", "Guest count must be between 1 and 9.");
    }
    const stays = await getStaysProvider().search({
      lat: destination.lat,
      lng: destination.lng,
      radiusKm: RADIUS_KM,
      checkIn,
      checkOut,
      adults,
    });
    return NextResponse.json({ stays });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
