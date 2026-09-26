import type { z } from "zod";

export interface EnvProblem {
  variable: string;
  message: string;
}

/** Thrown when the environment is invalid. The message lists every problem at once. */
export class EnvError extends Error {
  override readonly name = "EnvError";

  constructor(
    readonly problems: EnvProblem[],
    scope: "server" | "client",
  ) {
    super(
      `Invalid ${scope} environment. Fix these variables (web/.env.example lists them all):\n` +
        problems.map((p) => `  - ${p.variable}: ${p.message}`).join("\n"),
    );
  }
}

type Source = Record<string, string | undefined>;

/** `.env` files often leave a variable blank; blank means unset. */
export function withoutBlanks(source: Source): Source {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value?.trim() ? value : undefined]));
}

/** The error option for required values: "missing" when absent, the default message otherwise. */
export const missing = { error: (issue: { input?: unknown }) => (issue.input === undefined ? "missing" : undefined) };

/** One problem per variable, in the order Zod reported them. */
export function problemsFrom(error: z.ZodError | undefined, extra: EnvProblem[] = []): EnvProblem[] {
  const all = [
    ...(error?.issues ?? []).map((issue) => ({ variable: String(issue.path[0] ?? "(root)"), message: issue.message })),
    ...extra,
  ];
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.variable) && seen.add(p.variable));
}
