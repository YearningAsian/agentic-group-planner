import "server-only";
import { notFound } from "next/navigation";
import { getServerClient, type ServerClient } from "@/lib/supabase/server";

/** RLS makes a missing slug and a trip hidden from this caller the same null result. */
export async function findVisibleTripBySlug(client: ServerClient, slug: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(slug)) return null;
  const { data, error } = await client
    .from("trips")
    .select("id, slug, title, city, trip_date, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Only an authenticated member can see this page; other callers get Next's standard 404. */
export async function visibleTripBySlug(slug: string) {
  const trip = await findVisibleTripBySlug(await getServerClient(), slug);
  if (!trip) notFound();
  return trip;
}
