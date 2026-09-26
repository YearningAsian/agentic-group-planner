import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { createMockLlmProvider } from "./mock";
import { createGoogleProvider, createMetaProvider } from "./real";
import type { LlmProvider } from "./types";

export type * from "./types";
export { RecordingNotFoundError } from "./mock";

type LlmEnv = Pick<
  ServerEnv,
  | "LLM_PROVIDER"
  | "AGENT_MODEL"
  | "META_MODEL_API_KEY"
  | "META_MODEL_API_BASE_URL"
  | "GOOGLE_GENERATIVE_AI_API_KEY"
>;

/** Picks the implementation from `LLM_PROVIDER`. Pure, so tests can pass any env. */
export function selectLlmProvider(env: LlmEnv): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case "meta":
      return createMetaProvider({
        apiKey: env.META_MODEL_API_KEY,
        baseURL: env.META_MODEL_API_BASE_URL,
        agentModel: env.AGENT_MODEL,
      });
    case "google":
      return createGoogleProvider({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
        agentModel: env.AGENT_MODEL,
      });
    case "mock":
      return createMockLlmProvider();
  }
}

let cached: LlmProvider | undefined;

/** The provider for this process, chosen once from the validated env. */
export function getLlmProvider(): LlmProvider {
  cached ??= selectLlmProvider(getServerEnv());
  return cached;
}
