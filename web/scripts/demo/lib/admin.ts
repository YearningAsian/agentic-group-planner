import type { Database } from "@agp/shared/db";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ScriptAdmin = SupabaseClient<Database>;

/**
 * The service client for the demo scripts. Scripts run outside Next.js, so they can't import the
 * app's `server-only` admin module; they read the same two variables from web/.env.local.
 */
export function scriptAdmin(): ScriptAdmin {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (web/.env.local).");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
