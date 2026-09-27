import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { executeFlightSearch } from "@/lib/planner-chat/search";
import { FLIGHT_UNAVAILABLE } from "@/lib/planner-chat/types";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const origin = params.get("origin")?.trim() ?? "";
    const destination = params.get("destination")?.trim() ?? "";
    const departureDate = params.get("departureDate") ?? "";
    const returnDate = params.get("returnDate")?.trim() ?? "";
    const travelers = Number(params.get("travelers") ?? "1");
    if (origin.length < 2) throw new AppError("invalid_input", "Add where you're flying from.");
    if (destination.length < 2) throw new AppError("invalid_input", "Pick a destination first.");
    if (!DATE.test(departureDate)) throw new AppError("invalid_input", "Add a departure date to browse flights.");
    if (returnDate && (!DATE.test(returnDate) || returnDate <= departureDate)) {
      throw new AppError("invalid_input", "Return date must be after the departure date.");
    }
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 9) {
      throw new AppError("invalid_input", "Traveler count must be between 1 and 9.");
    }
    const token = getServerEnv().DUFFEL_ACCESS_TOKEN;
    if (!token) throw new AppError("provider_unavailable", "Flights are unavailable right now.");
    const result = await executeFlightSearch(
      {
        origin,
        destination,
        departureDate,
        ...(returnDate ? { returnDate } : {}),
        travelers,
      },
      { duffelToken: token },
    );
    if (!result.ok) {
      const unavailable = result.error === FLIGHT_UNAVAILABLE;
      throw new AppError(unavailable ? "provider_unavailable" : "invalid_input", result.error);
    }
    return NextResponse.json(result.note ? { flights: result.flights, note: result.note } : { flights: result.flights });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
