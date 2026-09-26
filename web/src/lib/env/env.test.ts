import { describe, expect, it } from "vitest";
import { parseClientEnv } from "./client";
import { EnvError } from "./error";
import { parseServerEnv } from "./server";

/** The build profile: dev mode, every provider on its mock, and no provider keys. */
const buildProfile = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  NEXT_PUBLIC_DEMO_MODE: "true",
  DEMO_ADMIN_TOKEN: "dev-token",
  LLM_PROVIDER: "mock",
  OPTIMIZER_URL: "http://localhost:8000",
  OPTIMIZER_TOKEN: "optimizer-token",
  PAYMENTS_PROVIDER: "mock",
  VOICE_PROVIDER: "mock",
  VOICE_TO_NUMBER_OVERRIDE: "+15555550100",
  PLACES_PROVIDER: "mock",
  ROUTING_PROVIDER: "mock",
};

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseServerEnv(source);
    return [];
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    return error.problems.map((p) => p.variable);
  }
}

describe("server env", () => {
  it("fails boot with a list of every missing required variable", () => {
    const required = [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "NEXT_PUBLIC_DEMO_MODE",
      "LLM_PROVIDER",
      "OPTIMIZER_URL",
      "OPTIMIZER_TOKEN",
      "PAYMENTS_PROVIDER",
      "VOICE_PROVIDER",
      "PLACES_PROVIDER",
      "ROUTING_PROVIDER",
    ];
    expect(() => parseServerEnv({})).toThrow(EnvError);
    expect(problems({}).sort()).toEqual([...required].sort());
    // One message names every problem, so a failed boot says exactly what to fix. An empty
    // value counts as missing.
    expect(() => parseServerEnv({ ...buildProfile, OPTIMIZER_TOKEN: "", LLM_PROVIDER: undefined })).toThrow(
      /LLM_PROVIDER[\s\S]*OPTIMIZER_TOKEN/,
    );
  });

  it("requires XAI_API_KEY only when LLM_PROVIDER=xai, and GOOGLE_GENERATIVE_AI_API_KEY only when google", () => {
    expect(problems({ ...buildProfile, LLM_PROVIDER: "xai" })).toEqual(["XAI_API_KEY"]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "xai", XAI_API_KEY: "xai-key" })).toEqual([]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "google" })).toEqual(["GOOGLE_GENERATIVE_AI_API_KEY"]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "g-key" })).toEqual([]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "mock" })).toEqual([]);
  });

  it("rejects a live Stripe key (sk_live_)", () => {
    const real = { ...buildProfile, PAYMENTS_PROVIDER: "real", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(problems({ ...real, STRIPE_SECRET_KEY: "sk_live_abc" })).toEqual(["STRIPE_SECRET_KEY"]);
    // Even with mock payments, a live key in the environment fails the boot.
    expect(problems({ ...buildProfile, STRIPE_SECRET_KEY: "sk_live_abc" })).toEqual(["STRIPE_SECRET_KEY"]);
    expect(problems({ ...real, STRIPE_SECRET_KEY: "sk_test_abc" })).toEqual([]);
  });

  it("requires VOICE_TO_NUMBER_OVERRIDE in E.164 when NEXT_PUBLIC_DEMO_MODE=true", () => {
    expect(problems({ ...buildProfile, VOICE_TO_NUMBER_OVERRIDE: undefined })).toEqual(["VOICE_TO_NUMBER_OVERRIDE"]);
    expect(problems({ ...buildProfile, VOICE_TO_NUMBER_OVERRIDE: "555-0100" })).toEqual(["VOICE_TO_NUMBER_OVERRIDE"]);
    const production = { ...buildProfile, NEXT_PUBLIC_DEMO_MODE: "false", DEMO_ADMIN_TOKEN: undefined };
    expect(problems({ ...production, VOICE_TO_NUMBER_OVERRIDE: undefined })).toEqual([]);
  });

  it("accepts the build profile: every provider mock and no provider keys", () => {
    const env = parseServerEnv(buildProfile);
    expect(env.NEXT_PUBLIC_DEMO_MODE).toBe(true);
    expect(env.LLM_PROVIDER).toBe("mock");
    expect(env.AGENT_MODEL).toBe("grok-4.7");
    expect(env.STAYS_PROVIDER).toBe("mock");
    expect(env.VOICE_MOCK_SCENARIO).toBe("accept");
  });
});

describe("client env", () => {
  it("parses only the public variables", () => {
    const env = parseClientEnv(buildProfile);
    expect(env).toEqual({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_DEMO_MODE: true,
    });
    expect(() => parseClientEnv({})).toThrow(EnvError);
  });
});
