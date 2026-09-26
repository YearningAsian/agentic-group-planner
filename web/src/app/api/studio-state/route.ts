import { z } from "zod";
import type { Json } from "@agp/shared/db";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  homeAddress: z.string().max(300),
  homeLat: z.number().nullable(),
  homeLng: z.number().nullable(),
});

const documentSchema = z.object({
  activeTripId: z.string().max(80).nullable(),
  trips: z.array(z.record(z.string(), z.unknown())).max(50),
  profile: profileSchema,
});

const empty = { activeTripId: null, trips: [], profile: { homeAddress: "", homeLat: null, homeLng: null } };

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

async function session() {
  const client = await getServerClient();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new AppError("unauthenticated", "Sign in to save your trips.");
  return { client, id: data.user.id };
}

/** The signed-in user's studio document. Missing row means they have not saved yet. */
export async function GET(): Promise<Response> {
  try {
    const { client, id } = await session();
    const { data, error } = await client
      .from("studio_state")
      .select("active_trip_id, trips, profile")
      .eq("profile_id", id)
      .maybeSingle();
    if (error) throw new AppError("internal", "Couldn't load your trips.", { cause: error, retryable: true });
    if (!data) return Response.json(empty);
    return Response.json({
      activeTripId: data.active_trip_id,
      trips: data.trips,
      profile: data.profile,
    });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}

/** Replaces the signed-in user's studio document. The profile id always comes from the session. */
export async function PUT(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("The request body must be JSON.");
  }
  const parsed = documentSchema.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid");

  try {
    const { client, id } = await session();
    const { error } = await client.from("studio_state").upsert({
      profile_id: id,
      active_trip_id: parsed.data.activeTripId,
      trips: parsed.data.trips as Json,
      profile: parsed.data.profile as Json,
    });
    if (error) throw new AppError("internal", "Couldn't save your trips.", { cause: error, retryable: true });
    return Response.json({ ok: true });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
