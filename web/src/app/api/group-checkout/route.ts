import { NextResponse } from "next/server";
import { createGroupCheckout, readPaidSession } from "@/features/trip-draft/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to check out.");
    const body: unknown = await request.json();
    const result = await createGroupCheckout(body, { profileId: data.user.id });
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
    const result = await readPaidSession(sessionId);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
