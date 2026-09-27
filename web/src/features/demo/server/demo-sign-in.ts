"use server";
import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { getServerClient } from "@/lib/supabase/server";
import { demoPasswordFor } from "../demo-credentials";
import { demoLoginRefusal } from "../demo-login-policy";
import { type DemoPersonKey, isDemoPersonKey } from "../demo-people";

export type DemoSignInResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "disabled" | "invalid" | "not_seeded" | "failed"; message: string };

const NOT_SEEDED = "Demo data isn't loaded. Run pnpm --filter web seed:demo";

/**
 * Dev mode only: signs the browser in as Person 1, 2, or 3 (design §10.1). The password is derived
 * from `DEMO_SEED_SECRET` here on the server and handed straight to Supabase, so neither the
 * secret nor the password reaches the browser; the session arrives as the usual cookie.
 *
 * Only the three seeded keys are accepted and the email is built here, so the action can't be
 * pointed at any other account. Results are returned, not thrown, because Next.js hides thrown
 * messages from the client in production.
 */
export async function demoSignInSeeded(person: DemoPersonKey): Promise<DemoSignInResult> {
  const env = getServerEnv();
  const refusal = demoLoginRefusal({
    demoMode: env.NEXT_PUBLIC_DEMO_MODE,
    vercelEnv: env.VERCEL_ENV,
    allowDemoLogin: env.ALLOW_DEMO_LOGIN,
    seedSecret: env.DEMO_SEED_SECRET,
  });
  if (refusal) {
    const message = refusal === "no_secret" ? "Demo logins need DEMO_SEED_SECRET on the server." : "Demo logins are off here.";
    return { ok: false, reason: "disabled", message };
  }
  if (!isDemoPersonKey(person)) return { ok: false, reason: "invalid", message: "Pick Person 1, 2, or 3." };

  const email = `${person}@${env.DEMO_EMAIL_DOMAIN}`.toLowerCase();
  const client = await getServerClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: demoPasswordFor(email, env.DEMO_SEED_SECRET!),
  });
  if (error?.code === "invalid_credentials") return { ok: false, reason: "not_seeded", message: NOT_SEEDED };
  if (error || !data.user) return { ok: false, reason: "failed", message: "Couldn't sign in. Try again." };
  return { ok: true, userId: data.user.id };
}
