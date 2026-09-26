import { NextResponse } from "next/server";
import { getGeocodingProvider } from "@/lib/providers/geocoding";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length < 2) {
      throw new AppError("invalid_input", "Type at least two characters.");
    }
    const suggestions = await getGeocodingProvider().suggest(query);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
