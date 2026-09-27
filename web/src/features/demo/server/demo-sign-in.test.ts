import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoPasswordFor } from "../demo-credentials";

const env: {
  NEXT_PUBLIC_DEMO_MODE: boolean;
  DEMO_EMAIL_DOMAIN: string;
  DEMO_SEED_SECRET: string | undefined;
  ALLOW_DEMO_LOGIN: boolean;
  VERCEL_ENV: string | undefined;
} = {
  NEXT_PUBLIC_DEMO_MODE: true,
  DEMO_EMAIL_DOMAIN: "demo.agp.test",
  DEMO_SEED_SECRET: "seed-secret",
  ALLOW_DEMO_LOGIN: false,
  VERCEL_ENV: undefined,
};
const signInWithPassword = vi.fn();

vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { signInWithPassword } }) }));

const { demoSignInSeeded } = await import("./demo-sign-in");

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(env, { NEXT_PUBLIC_DEMO_MODE: true, DEMO_SEED_SECRET: "seed-secret", ALLOW_DEMO_LOGIN: false, VERCEL_ENV: undefined });
  signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" }, session: {} }, error: null });
});

describe("demoSignInSeeded", () => {
  it("signs Person 1 in on the server with the password derived from DEMO_SEED_SECRET", async () => {
    await expect(demoSignInSeeded("person1")).resolves.toEqual({ ok: true, userId: "user-1" });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "person1@demo.agp.test",
      password: demoPasswordFor("person1@demo.agp.test", "seed-secret"),
    });
  });

  it("refuses when NEXT_PUBLIC_DEMO_MODE is off, before calling Supabase", async () => {
    env.NEXT_PUBLIC_DEMO_MODE = false;
    await expect(demoSignInSeeded("person2")).resolves.toMatchObject({ ok: false, reason: "disabled" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("refuses on Vercel production unless ALLOW_DEMO_LOGIN=true", async () => {
    env.VERCEL_ENV = "production";
    await expect(demoSignInSeeded("person2")).resolves.toMatchObject({ ok: false, reason: "disabled" });
    expect(signInWithPassword).not.toHaveBeenCalled();

    env.ALLOW_DEMO_LOGIN = true;
    await expect(demoSignInSeeded("person2")).resolves.toMatchObject({ ok: true });
  });

  it("accepts only Person 1, 2, or 3, so the action can't reach any other account", async () => {
    for (const person of ["person4", "admin@example.com", "", 3] as unknown[]) {
      await expect(demoSignInSeeded(person as "person1")).resolves.toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("says the demo data isn't loaded when Supabase rejects the derived credentials", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    await expect(demoSignInSeeded("person3")).resolves.toEqual({
      ok: false,
      reason: "not_seeded",
      message: "Demo data isn't loaded. Run pnpm --filter web seed:demo",
    });
  });

  it("says the demo data isn't loaded when an older Supabase sends only the message, no code", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 400, message: "Invalid login credentials" },
    });
    await expect(demoSignInSeeded("person1")).resolves.toMatchObject({ ok: false, reason: "not_seeded" });
  });

  it("names the missing DEMO_SEED_SECRET instead of calling Supabase", async () => {
    env.DEMO_SEED_SECRET = undefined;
    await expect(demoSignInSeeded("person1")).resolves.toEqual({
      ok: false,
      reason: "disabled",
      message: "Demo logins need DEMO_SEED_SECRET on the server.",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("says to wait when Supabase rate-limits sign-ins", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" },
    });
    await expect(demoSignInSeeded("person2")).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      message: "Too many sign-ins just now. Wait a minute and try again.",
    });
  });

  it("any other failure is a retryable message, never the raw Supabase error", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { status: 500, message: "db down" } });
    const result = await demoSignInSeeded("person1");
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(JSON.stringify(result)).not.toContain("db down");
  });
});
