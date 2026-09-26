import "server-only";
import type { components } from "@agp/shared/optimizer";
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import { AppError, withPolicy } from "@/lib/reliability";

export type PlanRequest = components["schemas"]["PlanRequest"];
export type PlanResponse = components["schemas"]["PlanResponse"];

/** Design §2.2 and §7.4: `/v1/plan` gets 8 s and one retry; enumeration covers CP-SAT inside FastAPI. */
const PLAN_TIMEOUT_MS = 8_000;
const PLAN_RETRIES = 1;

const score = z.number();
/** The response checked at runtime; the generated types alone can't catch a drifted service. */
const PlanResponseSchema = z.object({
  request_id: z.string(),
  engine: z.enum(["cp_sat", "enumeration"]),
  status: z.enum(["optimal", "feasible", "infeasible"]),
  solve_ms: z.number().int().min(0),
  plans: z.array(
    z.object({
      rank: z.number().int().min(1),
      total_score: score,
      fairness: score,
      split: z.boolean(),
      member_scores: z.array(
        z.object({ member_id: z.string(), score, preference: score, cost: score, travel: score }),
      ),
      assignments: z.array(
        z.object({ slot_key: z.string(), groups: z.array(z.object({ place_id: z.string(), member_ids: z.array(z.string()) })) }),
      ),
    }),
  ),
  slot_options: z.array(
    z.object({
      slot_key: z.string(),
      groups: z.array(
        z.object({
          member_ids: z.array(z.string()),
          options: z.array(
            z.object({ place_id: z.string(), rank: z.number().int(), score, preference: score, cost: score, travel: score, fairness: score }),
          ),
        }),
      ),
    }),
  ),
  infeasible_reasons: z.array(z.string()),
}) satisfies z.ZodType<PlanResponse>;

export interface OptimizerClient {
  plan(request: PlanRequest): Promise<PlanResponse>;
}

/** A non-2xx answer. `withPolicy` retries it when the status is 429 or 5xx. */
class OptimizerHttpError extends Error {
  override readonly name = "OptimizerHttpError";

  constructor(readonly status: number) {
    super(`The optimizer answered ${status}.`);
  }
}

export interface OptimizerClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Backoff before the retry; tests shorten it. */
  backoffMs?: number;
}

/** The typed FastAPI client (design §2.2): bearer auth, 8 s per attempt, one retry on 429/5xx or a network error. */
export function createOptimizerClient(options: OptimizerClientOptions): OptimizerClient {
  const fetch = options.fetch ?? globalThis.fetch;
  const url = new URL("v1/plan", options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`).toString();

  return {
    async plan(request) {
      let body: unknown;
      try {
        body = await withPolicy(
          async (signal) => {
            const response = await fetch(url, {
              method: "POST",
              headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
              body: JSON.stringify(request),
              signal,
            });
            if (!response.ok) throw new OptimizerHttpError(response.status);
            return response.json();
          },
          { timeoutMs: PLAN_TIMEOUT_MS, retries: PLAN_RETRIES, backoffMs: options.backoffMs },
        );
      } catch (error) {
        if (error instanceof OptimizerHttpError) {
          // A 4xx means our request or token is wrong; retrying or blaming the service won't help.
          throw new AppError("internal", "The planner rejected the request.", { retryable: false, cause: error });
        }
        throw error;
      }
      const parsed = PlanResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError("internal", "The planner sent an answer we can't read.", { retryable: false, cause: parsed.error });
      }
      return parsed.data;
    },
  };
}

let cached: OptimizerClient | undefined;

/** The client for this process, from `OPTIMIZER_URL` and `OPTIMIZER_TOKEN`. */
export function getOptimizerClient(): OptimizerClient {
  const env = getServerEnv();
  cached ??= createOptimizerClient({ baseUrl: env.OPTIMIZER_URL, token: env.OPTIMIZER_TOKEN });
  return cached;
}
