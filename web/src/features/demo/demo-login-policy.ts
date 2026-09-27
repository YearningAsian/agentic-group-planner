export type DemoLoginRefusal = "demo_mode_off" | "production" | "no_secret";

/**
 * Why instant demo logins are off here, or null when they're allowed. The login page hides the
 * cards and the server action refuses on the same answer.
 *
 * A production deploy refuses even in demo mode unless `ALLOW_DEMO_LOGIN=true`, so a stray
 * `NEXT_PUBLIC_DEMO_MODE=true` can't open seeded accounts on the real site.
 */
export function demoLoginRefusal(input: {
  demoMode: boolean;
  vercelEnv: string | undefined;
  allowDemoLogin: boolean;
  seedSecret: string | undefined;
}): DemoLoginRefusal | null {
  if (!input.demoMode) return "demo_mode_off";
  if (input.vercelEnv === "production" && !input.allowDemoLogin) return "production";
  if (!input.seedSecret) return "no_secret";
  return null;
}
