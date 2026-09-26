import "server-only";
import { z } from "zod";
import { EnvError, type EnvProblem, missing, problemsFrom, withoutBlanks } from "./error";

const providerFlag = z.enum(["real", "mock"], missing);
/** A Should feature's provider: mock unless switched on, so boot never needs its keys. */
const optionalFlag = z.enum(["real", "mock"]).default("mock");
const secret = z.string().min(1).optional();
/** Meta Model API model IDs, verified on dev.meta.ai on 2026-09-25. */
const model = (id: string) => z.string().min(1).default(id);

const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(missing).min(1),
  SUPABASE_SECRET_KEY: z.string(missing).min(1),
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"], missing).transform((value) => value === "true"),
  DEMO_ADMIN_TOKEN: secret,
  // Seeded users' email domain (design §9.3). Dev-mode sign-in accepts only this domain.
  DEMO_EMAIL_DOMAIN: z.string().min(1).default("demo.agp.test"),

  LLM_PROVIDER: z.enum(["meta", "google", "mock"]).default("meta"),
  AGENT_MODEL: model("muse-spark-1.3"),
  AGENT_RECORD: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
  META_MODEL_API_KEY: secret,
  META_MODEL_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
  GOOGLE_GENERATIVE_AI_API_KEY: secret,

  // Each Meta capability beyond the model has its own flag, so it can go real on its own.
  TRANSCRIBE_PROVIDER: optionalFlag,
  TRANSCRIBE_MODEL: model("muse-voice-transcribe-1.0"),

  OPTIMIZER_URL: z.url(missing),
  OPTIMIZER_TOKEN: z.string(missing).min(1),

  PAYMENTS_PROVIDER: providerFlag,
  STRIPE_SECRET_KEY: z
    .string()
    .refine((key) => key.startsWith("sk_test_"), "must be a test-mode key (sk_test_); live keys are refused")
    .optional(),
  STRIPE_WEBHOOK_SECRET: secret,

  PLACES_PROVIDER: providerFlag,
  GOOGLE_PLACES_API_KEY: secret,
  ROUTING_PROVIDER: providerFlag,
  ORS_API_KEY: secret,
  STAYS_PROVIDER: z.enum(["real", "mock"]).default("mock"),
  DUFFEL_ACCESS_TOKEN: z
    .string()
    .refine((token) => token.startsWith("duffel_test_"), "must be a test token (duffel_test_)")
    .optional(),

  // Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on scheduled calls. Unset, the cron
  // routes refuse every call.
  CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),

  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_AUTH_TOKEN: secret,
});

export type ServerEnv = z.infer<typeof serverSchema>;
type Source = Record<string, string | undefined>;

/** Keys a real provider needs only when it's selected. */
function conditionalProblems(source: Source): EnvProblem[] {
  const rules: [condition: boolean, reason: string, variables: string[]][] = [
    [(source.LLM_PROVIDER ?? "meta") === "meta", "LLM_PROVIDER=meta", ["META_MODEL_API_KEY"]],
    // The model defaults are Meta IDs, so the fallback names its own.
    [source.LLM_PROVIDER === "google", "LLM_PROVIDER=google", ["GOOGLE_GENERATIVE_AI_API_KEY", "AGENT_MODEL"]],
    [source.TRANSCRIBE_PROVIDER === "real", "TRANSCRIBE_PROVIDER=real", ["META_MODEL_API_KEY"]],
    [source.PAYMENTS_PROVIDER === "real", "PAYMENTS_PROVIDER=real", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]],
    [source.PLACES_PROVIDER === "real", "PLACES_PROVIDER=real", ["GOOGLE_PLACES_API_KEY"]],
    [source.ROUTING_PROVIDER === "real", "ROUTING_PROVIDER=real", ["ORS_API_KEY"]],
    [source.STAYS_PROVIDER === "real", "STAYS_PROVIDER=real", ["DUFFEL_ACCESS_TOKEN"]],
    [source.NEXT_PUBLIC_DEMO_MODE === "true", "dev mode", ["DEMO_ADMIN_TOKEN"]],
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
