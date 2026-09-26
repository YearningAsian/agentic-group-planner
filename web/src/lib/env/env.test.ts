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
      "OPTIMIZER_URL",
      "OPTIMIZER_TOKEN",
      "PAYMENTS_PROVIDER",
      "PLACES_PROVIDER",
      "ROUTING_PROVIDER",
    ];
    expect(() => parseServerEnv({})).toThrow(EnvError);
    // LLM_PROVIDER defaults to meta, so its key is missing too.
    expect(problems({}).sort()).toEqual([...required, "META_MODEL_API_KEY"].sort());
    // One message names every problem, so a failed boot says exactly what to fix. An empty
    // value counts as missing.
    const boot = () => parseServerEnv({ ...buildProfile, OPTIMIZER_TOKEN: "", LLM_PROVIDER: undefined });
    expect(boot).toThrow(/OPTIMIZER_TOKEN/);
    expect(boot).toThrow(/META_MODEL_API_KEY/);
  });

  it("LLM_PROVIDER defaults to meta and needs META_MODEL_API_KEY; google needs its key and explicit model IDs", () => {
    expect(problems({ ...buildProfile, LLM_PROVIDER: undefined })).toEqual(["META_MODEL_API_KEY"]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "meta" })).toEqual(["META_MODEL_API_KEY"]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "meta", META_MODEL_API_KEY: "meta-key" })).toEqual([]);
    // The defaults are Meta model IDs, so the fallback must name its own.
    expect(problems({ ...buildProfile, LLM_PROVIDER: "google" }).sort()).toEqual(
      ["AGENT_MODEL", "GOOGLE_GENERATIVE_AI_API_KEY"].sort(),
    );
    const google = { LLM_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "g-key", AGENT_MODEL: "g-model" };
    expect(problems({ ...buildProfile, ...google })).toEqual([]);
    expect(problems({ ...buildProfile, LLM_PROVIDER: "mock" })).toEqual([]);
    // xAI is a possible later adapter, not a built one.
    expect(problems({ ...buildProfile, LLM_PROVIDER: "xai" })).toEqual(["LLM_PROVIDER"]);
  });

  it("each Meta capability has its own flag, mock by default, and needs META_MODEL_API_KEY only when real", () => {
    const env = parseServerEnv(buildProfile);
    // Voice-note transcription is the one Meta capability beyond the model since the pivot (design §2.5).
    const flags = ["TRANSCRIBE_PROVIDER"] as const;
    for (const flag of flags) {
      expect(env[flag]).toBe("mock");
      expect(problems({ ...buildProfile, [flag]: "real" })).toEqual(["META_MODEL_API_KEY"]);
      expect(problems({ ...buildProfile, [flag]: "real", META_MODEL_API_KEY: "meta-key" })).toEqual([]);
    }
  });

  it("model IDs come from env, with the verified Meta defaults", () => {
    const env = parseServerEnv(buildProfile);
    expect(env.META_MODEL_API_BASE_URL).toBe("https://api.meta.ai/v1");
    expect(env.AGENT_MODEL).toBe("muse-spark-1.3");
    expect(env.TRANSCRIBE_MODEL).toBe("muse-voice-transcribe-1.0");
    expect(parseServerEnv({ ...buildProfile, AGENT_MODEL: "muse-spark-1.2" }).AGENT_MODEL).toBe("muse-spark-1.2");
  });

  it("rejects a live Stripe key (sk_live_)", () => {
    const real = { ...buildProfile, PAYMENTS_PROVIDER: "real", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(problems({ ...real, STRIPE_SECRET_KEY: "sk_live_abc" })).toEqual(["STRIPE_SECRET_KEY"]);
    // Even with mock payments, a live key in the environment fails the boot.
    expect(problems({ ...buildProfile, STRIPE_SECRET_KEY: "sk_live_abc" })).toEqual(["STRIPE_SECRET_KEY"]);
    expect(problems({ ...real, STRIPE_SECRET_KEY: "sk_test_abc" })).toEqual([]);
  });

  it("requires DEMO_ADMIN_TOKEN only in dev mode", () => {
    expect(problems({ ...buildProfile, DEMO_ADMIN_TOKEN: undefined })).toEqual(["DEMO_ADMIN_TOKEN"]);
    const production = { ...buildProfile, NEXT_PUBLIC_DEMO_MODE: "false", DEMO_ADMIN_TOKEN: undefined };
    expect(problems(production)).toEqual([]);
  });

  it("has no variables for the flows the journey pivot dropped (design §11.6)", () => {
    const env = parseServerEnv(buildProfile) as Record<string, unknown>;
    const dropped = ["VOICE_PROVIDER", "VOICE_TO_NUMBER_OVERRIDE", "ELEVENLABS_API_KEY", "VISION_MODEL"];
    for (const name of [...dropped, "SEGMENT_PROVIDER", "IMAGE_PROVIDER", "GROUNDING_PROVIDER"]) {
      expect(env, name).not.toHaveProperty(name);
    }
  });

  it("accepts the build profile: every provider mock and no provider keys", () => {
    const env = parseServerEnv(buildProfile);
    expect(env.NEXT_PUBLIC_DEMO_MODE).toBe(true);
    expect(env.LLM_PROVIDER).toBe("mock");
    expect(env.AGENT_MODEL).toBe("muse-spark-1.3");
    expect(env.STAYS_PROVIDER).toBe("mock");
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
