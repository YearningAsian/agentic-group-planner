/**
 * The seeded cast who sign in (design §10.1). Person 4 has no user: they join through the invite
 * link. Emails carry the batch outside the demo batch, so engineers' batches never collide.
 */
export const SEEDED_USERS = [
  { key: "person1", displayName: "Person 1" },
  { key: "person2", displayName: "Person 2" },
  { key: "person3", displayName: "Person 3" },
] as const;

export type SeededUserKey = (typeof SEEDED_USERS)[number]["key"];

/** person1@demo.agp.test in the demo batch; person1.dev-vo@demo.agp.test in dev-vo. */
export function seededEmail(key: SeededUserKey, batch: string, domain = process.env.DEMO_EMAIL_DOMAIN || "demo.agp.test"): string {
  const suffix = batch === "demo" ? "" : `.${batch.replace(/[^a-z0-9-]/g, "-")}`;
  return `${key}${suffix}@${domain}`;
}
