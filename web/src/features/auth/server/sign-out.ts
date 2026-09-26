"use server";
import "server-only";
import { getServerClient } from "@/lib/supabase/server";

/** Clears the Supabase session cookie. */
export async function signOut(): Promise<void> {
  const client = await getServerClient();
  await client.auth.signOut();
}
