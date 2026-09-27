import { createHmac } from "node:crypto";

/**
 * A seeded user's password: HMAC-SHA256 of their email, keyed by `DEMO_SEED_SECRET`. The seed sets
 * it and the instant-login action signs in with it, both on the server, so no demo password is
 * stored anywhere or ever sent to a browser.
 *
 * Kept free of `server-only` because the seed script (plain Node) imports it too.
 */
export function demoPasswordFor(email: string, secret: string): string {
  if (!secret) throw new Error("DEMO_SEED_SECRET is not set; see web/.env.example.");
  return createHmac("sha256", secret).update(`demo-login:${email.trim().toLowerCase()}`).digest("base64url");
}
