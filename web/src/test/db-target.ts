import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/** The keys a database or Stripe test run needs to reach a Supabase project. */
export const SUPABASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

export type DbTestTarget = "local" | "dev";
type Env = Record<string, string>;

const normalizeUrl = (url: string | undefined) => (url ?? "").trim().replace(/\/+$/, "").toLowerCase();

/**
 * Picks the env for the `db` and `stripe` test projects. `local` (the default) uses web/.env.local,
 * which points at `supabase start`. `dev` overlays the Supabase keys from web/.env.test.local, a
 * separate hosted project, for when Docker isn't available. Errors name keys and files, never values.
 */
export function resolveDbTestEnv(input: { target: string | undefined; local: Env; testLocal: Env | null }): {
  target: DbTestTarget;
  env: Env;
} {
  const target = input.target?.trim() || "local";
  if (target === "local") return { target, env: input.local };
  if (target !== "dev") throw new Error('DB_TEST_TARGET must be "local" or "dev".');

  if (!input.testLocal) {
    throw new Error("DB_TEST_TARGET=dev needs web/.env.test.local with the dev project's Supabase keys (see CONTRIBUTING.md).");
  }
  const missing = SUPABASE_KEYS.filter((key) => !input.testLocal?.[key]?.trim());
  if (missing.length > 0) throw new Error(`web/.env.test.local is missing ${missing.join(", ")}.`);

  // The suites create and delete rows; they must never touch the project the app itself uses.
  if (normalizeUrl(input.testLocal.NEXT_PUBLIC_SUPABASE_URL) === normalizeUrl(input.local.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(
      "web/.env.test.local points at the same project as web/.env.local. DB_TEST_TARGET=dev needs a separate Supabase project.",
    );
  }
  const overlay = Object.fromEntries(SUPABASE_KEYS.map((key) => [key, input.testLocal?.[key] ?? ""]));
  return { target, env: { ...input.local, ...overlay } };
}

function readEnvFile(file: string): Env | null {
  return existsSync(file) ? (parseEnv(readFileSync(file, "utf8")) as Env) : null;
}

/** Reads web/.env.local and web/.env.test.local from `dir`, then applies `DB_TEST_TARGET`. */
export function loadDbTestEnv(dir: string, target = process.env.DB_TEST_TARGET) {
  return resolveDbTestEnv({
    target,
    local: readEnvFile(path.join(dir, ".env.local")) ?? {},
    testLocal: readEnvFile(path.join(dir, ".env.test.local")),
  });
}
