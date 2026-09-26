import path from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const src = path.resolve(__dirname, "src");
const alias = {
  "@": src,
  "server-only": path.join(src, "test/server-only-stub.ts"),
};

/**
 * Projects:
 * - `unit` (node) and `unit-dom` (jsdom): fast tests with no database. `pnpm test` runs both.
 * - `db`: runs against the local Supabase stack, with env from `.env.local`. `pnpm test:db`.
 * - `stripe`: `PAYMENTS_PROVIDER=real` against Stripe test mode. `pnpm test:stripe`; never in CI.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  return {
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
            include: ["tests/db/**/*.test.ts"],
            env,
            testTimeout: 30_000,
            hookTimeout: 60_000,
          },
        },
        {
          extends: true,
          test: {
            name: "stripe",
            environment: "node",
            include: ["tests/stripe/**/*.test.ts"],
            env: { ...env, PAYMENTS_PROVIDER: "real" },
            testTimeout: 60_000,
          },
        },
      ],
    },
  };
});
