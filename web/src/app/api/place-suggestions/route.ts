import { NextResponse } from "next/server";
import { getPlaceSuggestionsProvider } from "@/lib/providers/place-suggestions";
import { AppError, toHttpError } from "@/lib/reliability/app-error";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (query.length < 2) {
      throw new AppError("invalid_input", "Type at least two characters.");
    }
    const suggestions = (await getPlaceSuggestionsProvider().suggest(query)).slice(0, 8);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
