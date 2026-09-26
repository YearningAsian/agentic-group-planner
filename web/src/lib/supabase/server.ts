import "server-only";
import type { Database } from "@agp/shared/db";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getClientEnv } from "@/lib/env/client";

export type ServerClient = SupabaseClient<Database>;

/**
 * A client acting as the signed-in user (session from cookies), so row-level security applies.
 * Create one per request.
 */
export async function getServerClient(): Promise<ServerClient> {
  const store = await cookies();
  const env = getClientEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies. The proxy refreshes the session on every
          // request, so skipping the write here is safe.
        }
      },
    },
  });
}
