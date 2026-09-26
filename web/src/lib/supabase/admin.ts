import "server-only";
import type { Database } from "@agp/shared/db";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AdminClient = SupabaseClient<Database>;

/** The admin client can't be built without the secret key; this names the fix. */
export class MissingSecretKeyError extends Error {
  override readonly name = "MissingSecretKeyError";

  constructor() {
    super("SUPABASE_SECRET_KEY is not set. The admin client needs it; see web/.env.example.");
  }
}

let cached: { url: string; key: string; client: AdminClient } | undefined;

/**
 * The service-role client. It bypasses row-level security, so it's for server-owned tables and
 * the RPC write functions only; user-owned writes go through `getServerClient()`.
 */
export function getAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new MissingSecretKeyError();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set; see web/.env.example.");
  if (cached?.url !== url || cached.key !== key) {
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    cached = { url, key, client };
  }
  return cached.client;
}
