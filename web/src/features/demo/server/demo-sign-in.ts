"use server";
import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerClient } from "@/lib/supabase/server";

const Email = z.email();

/**
 * Dev mode only: signs the browser in as a seeded user (design §10.1), such as
 * `person2@demo.agp.test`. The admin client generates a magic link, and the session client
 * verifies its hash, which sets the session cookie, so no password ever exists and no email is sent.
 *
 * Only the seeded-user domain (`DEMO_EMAIL_DOMAIN`) is accepted: generating a link for an unknown
 * address creates that user, and a dev-mode deploy must never become a way into a real account.
 *
 * @throws AppError `not_permitted` outside dev mode, `invalid_input` for an email outside the demo
 *   domain, and a retryable `internal` when Supabase rejects the link.
 */
export async function demoSignIn(email: string): Promise<{ userId: string }> {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_DEMO_MODE) {
    throw new AppError("not_permitted", "Seeded-user sign-in is only available in dev mode.");
  }

  const parsed = Email.safeParse(typeof email === "string" ? email.trim().toLowerCase() : email);
  if (!parsed.success || !parsed.data.endsWith(`@${env.DEMO_EMAIL_DOMAIN.toLowerCase()}`)) {
    throw new AppError("invalid_input", "Pick one of the seeded users.");
  }

  const { data: link, error: linkError } = await getAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: parsed.data,
  });
  if (linkError || !link.properties?.hashed_token) {
    throw new AppError("internal", "Couldn't sign in. Try again.", { retryable: true, cause: linkError });
  }

  const client = await getServerClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (error || !data.user) {
    throw new AppError("internal", "Couldn't sign in. Try again.", { retryable: true, cause: error });
  }
  return { userId: data.user.id };
}

/** Dev mode only: sign in as Person 1, 2, or 3. Person 4 joins through the invite link. */
export async function demoSignInSeeded(person: "person1" | "person2" | "person3"): Promise<{ userId: string }> {
  const env = getServerEnv();
  return demoSignIn(`${person}@${env.DEMO_EMAIL_DOMAIN}`);
}
