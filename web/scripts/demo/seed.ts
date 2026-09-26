/**
 * `pnpm seed:demo [--batch <name>] [--stage <stage>]`: seeds the Saturday trip for development and
 * tests (design §10.4). Safe to re-run: every row has a deterministic ID, rows with a status are
 * only inserted when missing (so a re-run never moves a status backward), and the cache rows are
 * upserted. Step 2 (Stripe customers) arrives with CO-302; step 5 runs the requested stage.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SEEDED_USERS, type SeededUserKey, seededEmail } from "./fixtures/users";
import { type ScriptAdmin, scriptAdmin } from "./lib/admin";
import { parseSeedArgs, type Stage } from "./lib/args";
import { runStages } from "./stages";
import { inviteTokenFor, slugFor, uuidFor } from "./lib/ids";
import { localToUtc, nextSaturday } from "./lib/time";

interface TripFixture {
  trip: { key: string; title: string; city: string; timezone: string; price_threshold_percent: number };
  members: {
    key: string;
    display_name: string;
    role: "organizer" | "member";
    status: "joined" | "placeholder";
    user: SeededUserKey | null;
    constraints: { budget_cents: number | null; dietary: string[]; interests: string[] };
  }[];
  items: {
    slot_key: string;
    label: string;
    category: string;
    starts: string;
    ends: string;
    together: boolean;
    area?: { label: string; lat: number; lng: number };
  }[];
  places: {
    key: string;
    name: string;
    category: string;
    address: string;
    lat: number;
    lng: number;
    price_level: number;
    rating: number;
    tags: string[];
    dietary_tags: string[];
    hours: Record<string, [string, string][]>;
    price_cents: number;
    duration_min: number;
  }[];
}

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
export const SATURDAY_TRIP: TripFixture = JSON.parse(readFileSync(path.join(FIXTURES, "saturday-trip.json"), "utf8"));

export interface SeedResult {
  batch: string;
  tripId: string;
  slug: string;
  inviteToken: string;
  counts: Record<string, number>;
}

function check<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) throw new Error(`seed: ${what} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

/** Step 1: the seeded users (auth admin API; the trigger makes each profile). Returns key → user ID. */
async function upsertUsers(admin: ScriptAdmin, batch: string): Promise<Record<SeededUserKey, string>> {
  const wanted = new Map(SEEDED_USERS.map((u) => [seededEmail(u.key, batch), u]));
  const found = new Map<string, string>();
  for (let page = 1; found.size < wanted.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`seed: listing users failed: ${error.message}`);
    for (const user of data.users) if (user.email && wanted.has(user.email)) found.set(user.email, user.id);
    if (data.users.length < 1000) break;
  }
  const ids = {} as Record<SeededUserKey, string>;
  for (const [email, user] of wanted) {
    let id = found.get(email);
    if (!id) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: user.displayName, seed_batch: batch },
      });
      if (created.error || !created.data.user) throw new Error(`seed: creating ${email} failed: ${created.error?.message}`);
      id = created.data.user.id;
    }
    ids[user.key] = id;
  }
  return ids;
}

/** Step 3: the places cache. Global, not per batch, so it's upserted by (provider, provider_place_id). */
async function upsertPlaces(admin: ScriptAdmin, trip: TripFixture): Promise<void> {
  const now = new Date().toISOString();
  const rows = trip.places.map((p) => ({
    provider: "seed",
    provider_place_id: p.key,
    name: p.name,
    category: p.category,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    price_level: p.price_level,
    rating: p.rating,
    tags: p.tags,
    dietary_tags: p.dietary_tags,
    hours: p.hours,
    raw: { price_cents: p.price_cents, duration_min: p.duration_min, source: "saturday-trip.json" },
    fetched_at: now,
  }));
  check(await admin.from("places").upsert(rows, { onConflict: "provider,provider_place_id" }), "places");
  // FE-305 writes this fixture; until then the map computes straight-line routes on demand.
  const routes = path.join(FIXTURES, "routes.json");
  if (existsSync(routes)) {
    check(await admin.from("routes").upsert(JSON.parse(readFileSync(routes, "utf8")), { onConflict: "from_place_id,to_place_id,mode" }), "routes");
  }
}

/** Step 4: the trip, its members, their constraints, and the four items. */
async function upsertTrip(admin: ScriptAdmin, batch: string, users: Record<SeededUserKey, string>, now: Date) {
  const f = SATURDAY_TRIP;
  const tripId = uuidFor(batch, `trip:${f.trip.key}`);
  const slug = slugFor(batch, `trip:${f.trip.key}`);
  const inviteToken = inviteTokenFor(batch);
  const date = nextSaturday(now, f.trip.timezone);
  const organizer = f.members.find((m) => m.role === "organizer")!;
  const memberId = (key: string) => uuidFor(batch, `member:${key}`);

  check(
    await admin.from("trips").upsert(
      {
        id: tripId,
        slug,
        title: f.trip.title,
        city: f.trip.city,
        trip_date: date,
        timezone: f.trip.timezone,
        price_threshold_percent: f.trip.price_threshold_percent,
        organizer_profile_id: users[organizer.user!],
        seed_batch: batch,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "trip",
  );
  check(
    await admin.from("trip_members").upsert(
      f.members.map((m, i) => ({
        id: memberId(m.key),
        trip_id: tripId,
        profile_id: m.user ? users[m.user] : null,
        display_name: m.display_name,
        role: m.role,
        status: m.status,
        invite_token: m.status === "placeholder" ? inviteToken : null,
        lane_color: `lane-${i + 1}`,
        sort_order: i + 1,
        seed_batch: batch,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "members",
  );
  check(
    await admin.from("member_constraints").upsert(
      f.members.map((m) => ({
        id: uuidFor(batch, `constraints:${m.key}`),
        trip_id: tripId,
        member_id: memberId(m.key),
        budget_cents: m.constraints.budget_cents,
        dietary: m.constraints.dietary,
        interests: m.constraints.interests,
        set_by_member_id: memberId(organizer.key),
        seed_batch: batch,
      })),
      { onConflict: "member_id" },
    ),
    "constraints",
  );
  check(
    await admin.from("itinerary_items").upsert(
      f.items.map((item) => ({
        id: uuidFor(batch, `item:${item.slot_key}`),
        trip_id: tripId,
        slot_key: item.slot_key,
        label: item.label,
        category: item.category,
        starts_at: localToUtc(date, item.starts, f.trip.timezone),
        ends_at: localToUtc(date, item.ends, f.trip.timezone),
        position: 1,
        together: item.together,
        area_label: item.area?.label ?? null,
        area_lat: item.area?.lat ?? null,
        area_lng: item.area?.lng ?? null,
        seed_batch: batch,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "items",
  );
  return { tripId, slug, inviteToken };
}

async function countRows(admin: ScriptAdmin, batch: string, tripId: string): Promise<Record<string, number>> {
  const count = async (table: "trips" | "trip_members" | "member_constraints" | "itinerary_items" | "profiles", column: string, value: string) => {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error) throw new Error(`seed: counting ${table} failed: ${error.message}`);
    return count ?? 0;
  };
  const places = await admin.from("places").select("*", { count: "exact", head: true }).eq("provider", "seed");
  return {
    profiles: await count("profiles", "seed_batch", batch),
    trips: await count("trips", "seed_batch", batch),
    trip_members: await count("trip_members", "trip_id", tripId),
    member_constraints: await count("member_constraints", "trip_id", tripId),
    itinerary_items: await count("itinerary_items", "trip_id", tripId),
    places: places.count ?? 0,
  };
}

/** Seeds one batch (design §10.4 steps 1 and 3–6). */
export async function seed(options: { batch: string; stage?: Stage; now?: Date; admin?: ScriptAdmin }): Promise<SeedResult> {
  const admin = options.admin ?? scriptAdmin();
  const users = await upsertUsers(admin, options.batch);
  await upsertPlaces(admin, SATURDAY_TRIP);
  const trip = await upsertTrip(admin, options.batch, users, options.now ?? new Date());
  await runStages({ admin, batch: options.batch, tripId: trip.tripId }, options.stage);
  return { batch: options.batch, ...trip, counts: await countRows(admin, options.batch, trip.tripId) };
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const result = await seed({ batch: args.batch, stage: args.stage });
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Seeded batch ${result.batch}.`);
  for (const [table, n] of Object.entries(result.counts)) console.log(`  ${table.padEnd(20)} ${n}`);
  console.log(`Trip:              ${app}/trip/${result.slug}`);
  console.log(`Person 4's invite: ${app}/invite/${result.inviteToken}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
