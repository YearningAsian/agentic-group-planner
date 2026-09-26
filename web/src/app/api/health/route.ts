import type { health } from "@agp/shared";
import { getServerEnv } from "@/lib/env/server";
import { withPolicy } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";

// Each check gets one short attempt: a health probe that retries or waits long hides an outage.
const CHECK_POLICY = { timeoutMs: 2_000, retries: 0 };

async function status(check: (signal: AbortSignal) => Promise<void>): Promise<health.HealthStatus> {
  try {
    await withPolicy(check, CHECK_POLICY);
    return "ok";
  } catch {
    return "error";
  }
}

/** A one-row read through PostgREST proves the API, the database, and the secret key all work. */
async function checkDb(signal: AbortSignal): Promise<void> {
  const { error } = await getAdminClient().from("trips").select("id").limit(1).abortSignal(signal);
  if (error) throw error;
}

/** The optimizer's unauthenticated `GET /health`, which answers `{ status: "ok" }`. */
async function checkOptimizer(signal: AbortSignal): Promise<void> {
  const base = getServerEnv().OPTIMIZER_URL;
  const url = new URL("health", base.endsWith("/") ? base : `${base}/`);
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`The optimizer answered ${response.status}.`);
  const body = (await response.json()) as { status?: unknown };
  if (body.status !== "ok") throw new Error("The optimizer isn't ready.");
}

/**
 * Reports the web app, database, and optimizer (design §2.4). It answers 200 with each
 * dependency's state rather than failing, so a monitor can tell which one is down.
 */
export async function GET(): Promise<Response> {
  const [db, optimizer] = await Promise.all([status(checkDb), status(checkOptimizer)]);
  return Response.json({ web: "ok", db, optimizer } satisfies health.HealthResponse, {
    headers: { "cache-control": "no-store" },
  });
}
