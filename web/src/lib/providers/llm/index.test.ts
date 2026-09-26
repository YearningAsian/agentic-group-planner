import { describe, expect, it } from "vitest";
import { selectLlmProvider } from "./index";

const env = {
  AGENT_MODEL: "muse-spark-1.3",
  VISION_MODEL: "muse-spark-1.3",
  META_MODEL_API_KEY: "test-key",
  META_MODEL_API_BASE_URL: "https://meta.test/v1",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
};

describe("selectLlmProvider", () => {
  it.each(["meta", "google", "mock"] as const)("LLM_PROVIDER=%s picks that provider", (name) => {
    expect(selectLlmProvider({ ...env, LLM_PROVIDER: name }).name).toBe(name);
  });
});
