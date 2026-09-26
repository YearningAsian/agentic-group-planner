/**
 * `pnpm reset:demo [--batch <name>] [--stage <stage>] [--all]`: puts a batch back to its seeded state,
 * at the given stage, in under 30 s (design §10.5). Open browsers reload on `demo.reset`; seeded users
 * stay signed in unless --all.
 */
import { pathToFileURL } from "node:url";
import { type ScriptAdmin, scriptAdmin } from "./lib/admin";
import { parseSeedArgs, type Stage } from "./lib/args";
import { resetPlan } from "./lib/reset-plan";
import { seed, type SeedResult } from "./seed";

function fail(what: string, error: unknown): never {
  throw new Error(`reset: ${what} failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
}

/** Every user's email, by ID, from the auth admin API. */
async function emailsById(admin: ScriptAdmin): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listing users", error);
    for (const user of data.users) if (user.email) emails.set(user.id, user.email);
    if (data.users.length < 1000) return emails;
  }
}

/** Tells every open client on the trip to drop its cache and reload (design §6). Best effort. */
async function announce(admin: ScriptAdmin, tripId: string, at: string): Promise<void> {
  const channel = admin.channel(`trip:${tripId}`);
  try {
    await channel.httpSend("demo.reset", { at });
  } catch (error) {
    console.warn(`reset: couldn't announce the reset on trip ${tripId}`, error);
  } finally {
    await admin.removeChannel(channel);
  }
}

/** Removes objects under the batch's prefix in every bucket. Nothing stores objects today. */
async function clearStorage(admin: ScriptAdmin, prefix: string): Promise<void> {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) return console.warn(`reset: skipped storage (${error.message})`);
  for (const bucket of buckets ?? []) {
    const { data: files } = await admin.storage.from(bucket.name).list(prefix.replace(/\/$/, ""), { limit: 1000 });
    const paths = (files ?? []).map((f) => `${prefix}${f.name}`);
    if (paths.length > 0) await admin.storage.from(bucket.name).remove(paths);
  }
}

export interface ResetResult {
  ms: number;
  deletedTrips: number;
  deletedUsers: number;
  seeded: SeedResult;
}

export async function reset(options: {
  batch: string;
  stage?: Stage;
  all?: boolean;
  admin?: ScriptAdmin;
  now?: Date;
}): Promise<ResetResult> {
  const started = Date.now();
  const admin = options.admin ?? scriptAdmin();
  const all = options.all ?? false;

  // 1. Announce, so open clients reload instead of showing rows that are about to vanish.
  const trips = await admin.from("trips").select("id").eq("seed_batch", options.batch);
  if (trips.error) fail("reading trips", trips.error);
  const at = new Date().toISOString();
  await Promise.all(trips.data.map((t) => announce(admin, t.id, at)));

  // 2. Trips: members, items, options, mandates, holds, bookings, messages, and runs cascade.
  const deleted = await admin.from("trips").delete().eq("seed_batch", options.batch);
  if (deleted.error) fail("deleting trips", deleted.error);

  // 3. Claimers (and, with --all, the seeded users). Profiles carry the batch.
  const profiles = await admin.from("profiles").select("id").eq("seed_batch", options.batch);
  if (profiles.error) fail("reading profiles", profiles.error);
  const emails = await emailsById(admin);
  const plan = resetPlan({
    batch: options.batch,
    all,
    users: profiles.data.map((p) => ({ id: p.id, email: emails.get(p.id) ?? null, seed_batch: options.batch })),
  });
  // A user who can't be deleted (say, the organizer of a trip in another batch) mustn't leave this
  // batch without a trip, so the re-seed still runs and the failures are reported after it.
  const undeleted: string[] = [];
  for (const id of plan.deleteUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) undeleted.push(`${id} (${error.message})`);
  }

  if (plan.deleteSeedPlaces) {
    const seedPlaces = await admin.from("places").select("id").eq("provider", "seed");
    if (seedPlaces.error) fail("reading places", seedPlaces.error);
    const ids = seedPlaces.data.map((p) => p.id);
    if (plan.deleteRoutesOfSeedPlaces && ids.length > 0) {
      const list = `(${ids.join(",")})`;
      const routes = await admin.from("routes").delete().or(`from_place_id.in.${list},to_place_id.in.${list}`);
      if (routes.error) fail("deleting routes", routes.error);
    }
    const places = await admin.from("places").delete().eq("provider", "seed");
    if (places.error) fail("deleting places", places.error);
  }
  if (plan.deleteStoragePrefix) await clearStorage(admin, plan.deleteStoragePrefix);

  // 4. Seed again (design §10.4 steps 4–6): users and places are kept (or recreated after --all),
  // the trip starts fresh, and the requested stage runs.
  const seeded = await seed({ batch: options.batch, stage: options.stage, admin, now: options.now });
  if (undeleted.length > 0) {
    throw new Error(
      `reset: re-seeded, but couldn't delete ${undeleted.length} user(s): ${undeleted.join("; ")}. Remove what still references them, then reset again.`,
    );
  }
  return { ms: Date.now() - started, deletedTrips: trips.data.length, deletedUsers: plan.deleteUserIds.length, seeded };
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const result = await reset({ batch: args.batch, stage: args.stage, all: args.all });
  console.log(
    `Reset batch ${args.batch} in ${(result.ms / 1000).toFixed(1)} s: ${result.deletedTrips} trip(s) and ${result.deletedUsers} user(s) removed, then seeded.`,
  );
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Trip:              ${app}/trip/${result.seeded.slug}`);
  console.log(`Person 4's invite: ${app}/invite/${result.seeded.inviteToken}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
