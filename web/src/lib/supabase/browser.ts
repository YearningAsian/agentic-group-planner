import type { Database } from "@agp/shared/db";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientEnv } from "@/lib/env/client";
import { EnvError } from "@/lib/env/error";

export type BrowserClient = SupabaseClient<Database>;

let client: BrowserClient | undefined;

/** The one browser client: session in cookies, shared with the server and the proxy. */
export function getBrowserClient(): BrowserClient {
  if (!client) {
    const env = getClientEnv();
    client = createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  }
  return client;
}

/**
 * Same as `getBrowserClient`, or `null` when public env is unset.
 * Used so SSG can render marketing pages on Vercel previews that lack `NEXT_PUBLIC_*` yet.
 */
export function tryGetBrowserClient(): BrowserClient | null {
  try {
    return getBrowserClient();
  } catch (error) {
    if (error instanceof EnvError) return null;
    throw error;
  }
}
