/**
 * Database test harness. Tests run against the local Supabase stack (`supabase start`), and every
 * row they create carries a unique `seed_batch`, so parallel files never see each other's data
 * and `cleanup(batch)` removes exactly what a file made.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`supabase start\` and fill in web/.env.local.`);
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** A batch name unique to one test file run. */
export function testBatch(): string {
  return `test:${randomUUID()}`;
}

/** The service client. It bypasses row-level security, like the server's admin client. */
export function adminClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), noSession);
}

/** A client with the publishable key and no session: what an anonymous browser starts with. */
export function publicClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), noSession);
}

export interface TestUser {
  userId: string;
  email: string | null;
  /** Signed in as this user, so row-level security applies. */
  client: SupabaseClient;
}

/**
 * Creates an auth user (the `handle_new_user` trigger makes its profile) and returns a client
 * signed in as them. The batch goes in user_metadata, so the profile carries it and
 * `cleanup(batch)` deletes the user.
 */
export async function createUser(opts: { batch: string; displayName?: string; anonymous?: boolean }): Promise<TestUser> {
  const client = publicClient();
  const metadata: Record<string, string> = { seed_batch: opts.batch };
  if (opts.displayName) metadata.display_name = opts.displayName;

  if (opts.anonymous) {
    const { data, error } = await client.auth.signInAnonymously({ options: { data: metadata } });
    if (error || !data.user) throw error ?? new Error("anonymous sign-in returned no user");
    return { userId: data.user.id, email: null, client };
  }

  const email = `${randomUUID()}@test.agp.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { userId: data.user.id, email, client };
}

export interface TestMember {
  displayName: string;
  /** Joined members need a profile; placeholders and invited members have none. */
  profileId?: string;
  role?: "organizer" | "member";
  status?: "placeholder" | "invited" | "joined";
  inviteToken?: string;
}

/**
 * Creates a trip and its members with the admin client. The first member is the organizer
 * unless another is marked `role: "organizer"`, and the organizer needs a `profileId`.
 */
export async function createTrip(
  batch: string,
  opts: { members: TestMember[]; title?: string; tripDate?: string },
): Promise<{ tripId: string; slug: string; memberIds: string[] }> {
  const admin = adminClient();
  const organizerIndex = Math.max(0, opts.members.findIndex((m) => m.role === "organizer"));
  const organizer = opts.members[organizerIndex];
  if (!organizer?.profileId) throw new Error("createTrip: the organizer needs a profileId");

  const slug = randomBytes(9).toString("base64url").slice(0, 11);
  const { data: trip, error } = await admin
    .from("trips")
    .insert({
      slug,
      title: opts.title ?? "Test trip",
      city: "Atlanta",
      trip_date: opts.tripDate ?? "2026-09-26",
      organizer_profile_id: organizer.profileId,
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (error) throw error;

  const rows = opts.members.map((m, i) => ({
    trip_id: trip.id,
    profile_id: m.profileId ?? null,
    display_name: m.displayName,
    role: i === organizerIndex ? "organizer" : "member",
    status: m.status ?? (m.profileId ? "joined" : "placeholder"),
    invite_token: m.inviteToken ?? null,
    lane_color: `lane-${(i % 6) + 1}`,
    sort_order: i + 1,
    seed_batch: batch,
  }));
  const { data: members, error: memberError } = await admin.from("trip_members").insert(rows).select("id, sort_order");
  if (memberError) throw memberError;
  const memberIds = [...members].sort((a, b) => a.sort_order - b.sort_order).map((m) => m.id as string);
  return { tripId: trip.id as string, slug, memberIds };
}

/** Adds a place to the global cache, tagged with the batch so `cleanup` removes it. */
export async function createPlace(
  batch: string,
  overrides: Record<string, unknown> = {},
): Promise<{ placeId: string }> {
  const { data, error } = await adminClient()
    .from("places")
    .insert({
      provider: "mock",
      provider_place_id: randomUUID(),
      name: "Test place",
      category: "activity",
      lat: 33.7634,
      lng: -84.3951,
      fetched_at: new Date().toISOString(),
      seed_batch: batch,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { placeId: data.id as string };
}

/** Deletes the batch's trips (members and everything trip-scoped cascade), places, then users. */
export async function cleanup(batch: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("trips").delete().eq("seed_batch", batch);
  if (error) throw error;
  const { error: placeError } = await admin.from("places").delete().eq("seed_batch", batch);
  if (placeError) throw placeError;
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id").eq("seed_batch", batch);
  if (profileError) throw profileError;
  for (const { id } of profiles ?? []) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id as string);
    if (deleteError) throw deleteError;
  }
}
