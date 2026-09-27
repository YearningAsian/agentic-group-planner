/**
 * Deterministic IDs for seed data, so `seed:demo` upserts the same rows every run and each batch
 * gets its own rows.
 */
import { createHash, createHmac } from "node:crypto";

// A fixed namespace for this app's seed data (a random v4 UUID, chosen once).
const SEED_NAMESPACE = "8f1c5a52-3f7e-4b8a-9d0c-6e2a41b7c3d9";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 version 5: SHA-1 of namespace + name, with the version and variant bits set. */
function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(uuidToBytes(namespace)).update(name, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** The seeded row's ID: UUIDv5 of `{batch}:{name}`. */
export function uuidFor(batch: string, name: string): string {
  return uuidV5(SEED_NAMESPACE, `${batch}:${name}`);
}
uuidFor.fromNamespace = uuidV5;

/**
 * Person 4's invite token: stable across resets, so a saved invite link keeps working, but keyed
 * by DEMO_SEED_SECRET, so it can't be derived from the repo.
 */
export function inviteTokenFor(batch: string, member = "person4"): string {
  const secret = process.env.DEMO_SEED_SECRET;
  if (!secret) throw new Error("DEMO_SEED_SECRET is not set; see web/.env.example.");
  return createHmac("sha256", secret).update(`invite:${batch}:${member}`).digest("base64url").slice(0, 21);
}
