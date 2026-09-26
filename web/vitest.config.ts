import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadDbTestEnv } from "./src/test/db-target";

const src = path.resolve(__dirname, "src");
const alias = {
  "@": src,
  "server-only": path.join(src, "test/server-only-stub.ts"),
};

/**
 * Projects:
 * - `unit` (node) and `unit-dom` (jsdom): fast tests with no database. `pnpm test` runs both.
 * - `db`: database tests and the payments suites on mock payments. `pnpm test:db`.
 * - `stripe`: the payments suites with `PAYMENTS_PROVIDER=real` on Stripe test mode. `pnpm test:stripe`; never in CI.
 *
 * Both reach Supabase through `DB_TEST_TARGET`: `local` (default) uses `.env.local` and `supabase start`;
 * `dev` uses a separate hosted project whose keys live in `.env.test.local` (src/test/db-target.ts).
 */
const { env } = loadDbTestEnv(__dirname);

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "tests/lint/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts", "tests/payments/**/*.test.ts"],
          env,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          environment: "node",
          include: ["scripts/sandbox-smoke.ts"],
          env,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "stripe",
          environment: "node",
          include: ["tests/payments/**/*.test.ts"],
          env: { ...env, PAYMENTS_PROVIDER: "real" },
          // The fronting race runs five full purchases against Stripe (about 70 s); mock runs take ~2 s.
          testTimeout: 180_000,
        },
      },
    ],
  },
});
