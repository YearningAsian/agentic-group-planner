import { z } from "zod";
import { EnvError, missing, problemsFrom, withoutBlanks } from "./error";

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_URL: z.url(missing),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(missing).min(1),
  /** `true` is dev mode: seeded-user picker, dev toolbar, and `/api/demo/*`. Never true in production. */
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"], missing).transform((value) => value === "true"),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

/** Validates the public variables. Pure, so tests can pass any source. */
export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const result = clientSchema.safeParse(withoutBlanks(source));
  if (!result.success) throw new EnvError(problemsFrom(result.error), "client");
  return result.data;
}

let cached: ClientEnv | undefined;

/**
 * The public environment. Each variable is referenced by its full name, because Next.js inlines
 * `process.env.NEXT_PUBLIC_*` into the browser bundle only for static references.
 */
export function getClientEnv(): ClientEnv {
  cached ??= parseClientEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  return cached;
}

/** Validated on first read, so importing this module never throws. */
export const clientEnv: ClientEnv = new Proxy({} as ClientEnv, {
  get: (_, key) => getClientEnv()[key as keyof ClientEnv],
});
