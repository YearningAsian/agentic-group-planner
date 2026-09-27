import { NextResponse } from "next/server";
import { createGroupCheckout, readPaidSession } from "@/features/trip-draft/server/group-checkout";
import { toHttpError } from "@/lib/reliability/app-error";

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const result = await createGroupCheckout(body);
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
