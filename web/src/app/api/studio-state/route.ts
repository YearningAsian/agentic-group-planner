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

const emptyProfile = { homeAddress: "", homeLat: null, homeLng: null };
const BOARD_ID = "demo";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

function profileFrom(value: unknown) {
  const parsed = profileSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyProfile;
}

async function session() {
  const client = await getServerClient();
  const { data, error } = await client.auth.getUser();
  // #region agent log
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const names = store.getAll().map((cookie) => cookie.name);
  const authNames = names.filter((name) => name.startsWith("sb-") || name.includes("auth"));
  const authLog = {
    sessionId: "811c21",
    hypothesisId: "B-C",
    location: "studio-state/route.ts:session",
    message: "server auth on save",
    data: {
      hasUser: Boolean(data.user),
      authError: error?.message ?? null,
      authStatus: error?.status ?? null,
      authCode: error && "code" in error ? String(error.code) : null,
      cookieCount: names.length,
      authCookieNames: authNames,
    },
    timestamp: Date.now(),
  };
  console.info("DEBUG811c21", JSON.stringify(authLog));
  fetch("http://127.0.0.1:7544/ingest/ae10d957-dcfc-49ae-b19f-e3a8284963a1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "811c21" },
    body: JSON.stringify({
      sessionId: "811c21",
      hypothesisId: "B-C",
      location: "studio-state/route.ts:session",
      message: "server auth on save",
      data: {
        hasUser: Boolean(data.user),
        authError: error?.message ?? null,
        authStatus: error?.status ?? null,
        authCode: error && "code" in error ? String(error.code) : null,
        cookieCount: names.length,
        cookieNames: names,
        authCookieNames: authNames,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!data.user) throw new AppError("unauthenticated", "Sign in to save your trips.");
  return { client, id: data.user.id };
}

/** Shared trips plus the signed-in user's home address. */
export async function GET(): Promise<Response> {
  try {
    const { client, id } = await session();
    const [board, profile] = await Promise.all([
      client.from("studio_board").select("active_trip_id, trips").eq("id", BOARD_ID).maybeSingle(),
      client.from("studio_state").select("profile").eq("profile_id", id).maybeSingle(),
    ]);
    if (board.error || profile.error) {
      throw new AppError("internal", "Couldn't load your trips.", {
        cause: board.error ?? profile.error,
        retryable: true,
      });
    }
    return Response.json({
      activeTripId: board.data?.active_trip_id ?? null,
      trips: Array.isArray(board.data?.trips) ? board.data.trips : [],
      profile: profileFrom(profile.data?.profile),
    });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}

/** Writes trips onto the shared board and the home address onto the session user. */
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
    const [board, profile] = await Promise.all([
      client
        .from("studio_board")
        .update({
          active_trip_id: parsed.data.activeTripId,
          trips: parsed.data.trips as Json,
        })
        .eq("id", BOARD_ID),
      client.from("studio_state").upsert({
        profile_id: id,
        profile: parsed.data.profile as Json,
      }),
    ]);
    if (board.error || profile.error) {
      throw new AppError("internal", "Couldn't save your trips.", {
        cause: board.error ?? profile.error,
        retryable: true,
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
