import "server-only";
import { z } from "zod";
import { EnvError, type EnvProblem, missing, problemsFrom, withoutBlanks } from "./error";

const E164 = /^\+[1-9]\d{7,14}$/;
const providerFlag = z.enum(["real", "mock"], missing);
const secret = z.string().min(1).optional();

const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(missing).min(1),
  SUPABASE_SECRET_KEY: z.string(missing).min(1),
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"], missing).transform((value) => value === "true"),
  DEMO_ADMIN_TOKEN: secret,

  LLM_PROVIDER: z.enum(["xai", "google", "mock"], missing),
  AGENT_MODEL: z.string().min(1).default("grok-4.7"),
  VISION_MODEL: z.string().min(1).default("grok-4.7"),
  AGENT_RECORD: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
  XAI_API_KEY: secret,
  GOOGLE_GENERATIVE_AI_API_KEY: secret,

  OPTIMIZER_URL: z.url(missing),
  OPTIMIZER_TOKEN: z.string(missing).min(1),

  PAYMENTS_PROVIDER: providerFlag,
  STRIPE_SECRET_KEY: z
    .string()
    .refine((key) => key.startsWith("sk_test_"), "must be a test-mode key (sk_test_); live keys are refused")
    .optional(),
  STRIPE_WEBHOOK_SECRET: secret,

  VOICE_PROVIDER: providerFlag,
  ELEVENLABS_API_KEY: secret,
  ELEVENLABS_AGENT_ID: secret,
  ELEVENLABS_PHONE_NUMBER_ID: secret,
  ELEVENLABS_WEBHOOK_SECRET: secret,
  ELEVENLABS_TOOL_SECRET: secret,
  VOICE_MOCK_SCENARIO: z
    .enum(["accept", "outside-window", "tool-never-fires", "duplicate-tool", "webhook-first", "no-answer"])
    .default("accept"),
  /** When set, every call dials this number instead of the venue's. */
  VOICE_TO_NUMBER_OVERRIDE: z.string().regex(E164, "must be E.164, like +15555550100").optional(),

  PLACES_PROVIDER: providerFlag,
  GOOGLE_PLACES_API_KEY: secret,
  ROUTING_PROVIDER: providerFlag,
  ORS_API_KEY: secret,
  STAYS_PROVIDER: z.enum(["real", "mock"]).default("mock"),
  DUFFEL_ACCESS_TOKEN: z
    .string()
    .refine((token) => token.startsWith("duffel_test_"), "must be a test token (duffel_test_)")
    .optional(),

  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_AUTH_TOKEN: secret,
});

export type ServerEnv = z.infer<typeof serverSchema>;
type Source = Record<string, string | undefined>;

/** Keys a real provider needs only when it's selected. */
function conditionalProblems(source: Source): EnvProblem[] {
  const rules: [condition: boolean, reason: string, variables: string[]][] = [
    [source.LLM_PROVIDER === "xai", "LLM_PROVIDER=xai", ["XAI_API_KEY"]],
    [source.LLM_PROVIDER === "google", "LLM_PROVIDER=google", ["GOOGLE_GENERATIVE_AI_API_KEY"]],
    [source.PAYMENTS_PROVIDER === "real", "PAYMENTS_PROVIDER=real", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]],
    [
      source.VOICE_PROVIDER === "real",
      "VOICE_PROVIDER=real",
      [
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_AGENT_ID",
        "ELEVENLABS_PHONE_NUMBER_ID",
        "ELEVENLABS_WEBHOOK_SECRET",
        "ELEVENLABS_TOOL_SECRET",
      ],
    ],
    [source.PLACES_PROVIDER === "real", "PLACES_PROVIDER=real", ["GOOGLE_PLACES_API_KEY"]],
    [source.ROUTING_PROVIDER === "real", "ROUTING_PROVIDER=real", ["ORS_API_KEY"]],
    [source.STAYS_PROVIDER === "real", "STAYS_PROVIDER=real", ["DUFFEL_ACCESS_TOKEN"]],
    [source.NEXT_PUBLIC_DEMO_MODE === "true", "dev mode", ["DEMO_ADMIN_TOKEN", "VOICE_TO_NUMBER_OVERRIDE"]],
  ];
  return rules.flatMap(([condition, reason, variables]) =>
    condition ? variables.filter((v) => !source[v]).map((v) => ({ variable: v, message: `missing (required with ${reason})` })) : [],
  );
}

/** Validates the server environment. Pure, so tests can pass any source. */
export function parseServerEnv(rawSource: Source): ServerEnv {
  const source = withoutBlanks(rawSource);
  const result = serverSchema.safeParse(source);
  const problems = problemsFrom(result.success ? undefined : result.error, conditionalProblems(source));
  if (problems.length > 0 || !result.success) throw new EnvError(problems, "server");
  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Validated on first read (and at boot, by instrumentation), so importing never throws. */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get: (_, key) => getServerEnv()[key as keyof ServerEnv],
});
