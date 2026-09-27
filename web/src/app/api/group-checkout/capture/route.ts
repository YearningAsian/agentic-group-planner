import { NextResponse } from "next/server";
import { captureHeldGroup } from "@/features/trip-draft/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to check out.");
    const body: unknown = await request.json();
    const sessionId = body && typeof body === "object" && "sessionId" in body ? body.sessionId : "";
    if (typeof sessionId !== "string") throw new AppError("invalid_input", "That checkout session is invalid.");
    const state = await captureHeldGroup(sessionId);
    return NextResponse.json({ state });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return NextResponse.json(body, { status });
  }
}
