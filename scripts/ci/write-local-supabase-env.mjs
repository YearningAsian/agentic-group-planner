import { writeFileSync } from "node:fs";

// Read `supabase status -o json` from stdin. Never log it: it contains locally generated keys.
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let status;
try {
  status = JSON.parse(raw);
} catch {
  throw new Error("Supabase status did not return valid JSON.");
}

function first(...names) {
  for (const name of names) {
    const value = status[name];
    if (typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value)) return value;
  }
  throw new Error(`Supabase status is missing ${names.join(" or ")}.`);
}

const env = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: first("API_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: first("PUBLISHABLE_KEY", "ANON_KEY"),
  SUPABASE_SECRET_KEY: first("SECRET_KEY", "SERVICE_ROLE_KEY"),
  NEXT_PUBLIC_DEMO_MODE: "true",
  DEMO_ADMIN_TOKEN: "ci-only-demo-token",
  DEMO_SEED_SECRET: "ci-only-seed-secret",
  LLM_PROVIDER: "mock",
  OPTIMIZER_URL: "http://localhost:8000",
  OPTIMIZER_TOKEN: "ci-only-optimizer-token",
  PAYMENTS_PROVIDER: "mock",
  PLACES_PROVIDER: "mock",
  ROUTING_PROVIDER: "mock",
};

writeFileSync(new URL("../../web/.env.local", import.meta.url), Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", {
  mode: 0o600,
});
