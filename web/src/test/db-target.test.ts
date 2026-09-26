import { describe, expect, it } from "vitest";
import { resolveDbTestEnv } from "./db-target";

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
  DEMO_SEED_SECRET: "seed",
};
const testLocal = {
  NEXT_PUBLIC_SUPABASE_URL: "https://dev-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dev-publishable",
  SUPABASE_SECRET_KEY: "dev-secret-value",
};

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error("expected a throw");
}

describe("resolveDbTestEnv", () => {
  it("defaults to the local stack and uses web/.env.local as is", () => {
    expect(resolveDbTestEnv({ target: undefined, local, testLocal })).toEqual({ target: "local", env: local });
    expect(resolveDbTestEnv({ target: "", local, testLocal }).target).toBe("local");
  });

  it("rejects an unknown target", () => {
    expect(() => resolveDbTestEnv({ target: "prod", local, testLocal })).toThrow(/DB_TEST_TARGET must be "local" or "dev"/);
  });

  it("dev overlays the three Supabase keys from .env.test.local on the local env", () => {
    const { target, env } = resolveDbTestEnv({ target: "dev", local, testLocal });
    expect(target).toBe("dev");
    expect(env).toEqual({ ...local, ...testLocal });
  });

  it("dev without .env.test.local names the file", () => {
    expect(() => resolveDbTestEnv({ target: "dev", local, testLocal: null })).toThrow(/web\/\.env\.test\.local/);
  });

  it("dev names every missing key, and never prints a value", () => {
    const partial = { NEXT_PUBLIC_SUPABASE_URL: testLocal.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY: "" };
    expect(() => resolveDbTestEnv({ target: "dev", local, testLocal: partial })).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY/,
    );
    const sameProject = { ...local, NEXT_PUBLIC_SUPABASE_URL: testLocal.NEXT_PUBLIC_SUPABASE_URL };
    const message = errorMessage(() => resolveDbTestEnv({ target: "dev", local: sameProject, testLocal }));
    expect(message).not.toContain(testLocal.SUPABASE_SECRET_KEY);
    expect(message).not.toContain(testLocal.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("dev refuses a project that web/.env.local also points at", () => {
    const same = { ...local, NEXT_PUBLIC_SUPABASE_URL: `${testLocal.NEXT_PUBLIC_SUPABASE_URL}/` };
    expect(() => resolveDbTestEnv({ target: "dev", local: same, testLocal })).toThrow(/separate Supabase project/);
  });
});
