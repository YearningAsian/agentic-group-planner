import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount, type LanguageModel, Output } from "ai";
import { z } from "zod";
import type { LlmProvider, LlmProviderName } from "./types";

// Design §7.4: 25 s per model step, 90 s per run, and one retry of a failed model call. The SDK
// retries only the model request, never a tool, so a retry can't repeat a side effect.
const STEP_MS = 25_000;
const RUN_MS = 90_000;
const MODEL_RETRIES = 1;
const DEFAULT_MAX_STEPS = 6;

const ImageDescription = z.object({
  caption: z.string().min(1).max(200),
  aesthetic_score: z.number().min(0).max(1),
});

function createAiSdkProvider(name: LlmProviderName, agentModel: LanguageModel, visionModel: LanguageModel): LlmProvider {
  const generateObject: LlmProvider["generateObject"] = async ({ schema, prompt, images = [] }) => {
    const result = await generateText({
      model: images.length > 0 ? visionModel : agentModel,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image" as const, image: new URL(url) }))],
        },
      ],
      // JSON-schema mode (response_format), never a forced tool call: Meta rejects forced tools.
      output: Output.object({ schema }),
      timeout: STEP_MS,
      maxRetries: MODEL_RETRIES,
    });
    // Output.object validates against `schema` at runtime; its type can't see through the generic.
    return result.output as z.output<typeof schema>;
  };

  return {
    name,

    async runAgent(input) {
      const result = await generateText({
        model: agentModel,
        instructions: input.system,
        messages: input.messages,
        tools: input.tools,
        // Meta returns 400 for any tool_choice but "auto" (ADR 0017), so the loop never forces one.
        toolChoice: "auto",
        stopWhen: isStepCount(input.maxSteps ?? DEFAULT_MAX_STEPS),
        timeout: { totalMs: RUN_MS, stepMs: STEP_MS },
        maxRetries: MODEL_RETRIES,
        abortSignal: input.signal,
      });
      const steps = result.steps.flatMap((step) =>
        step.toolResults.map(({ toolName, input: toolInput, output }) => ({ toolName, input: toolInput, output })),
      );
      const { inputTokens, outputTokens, totalTokens } = result.totalUsage;
      return { text: result.text, steps, usage: { inputTokens, outputTokens, totalTokens }, provider: name, replayed: false };
    },

    generateObject,

    describeImage: ({ url, context }) =>
      generateObject({
        schema: ImageDescription,
        prompt: `Write a one-sentence caption for this trip photo and rate how good a photo it is from 0 to 1. Context: ${context}`,
        images: [url],
      }),
  };
}

export interface MetaProviderOptions {
  apiKey?: string;
  baseURL: string;
  agentModel: string;
  visionModel: string;
  /** Tests pass a scripted fetch; production uses the global one. */
  fetch?: typeof globalThis.fetch;
}

/** Muse on Meta's Model API over Chat Completions (ADR 0017). */
export function createMetaProvider(options: MetaProviderOptions): LlmProvider {
  const meta = createOpenAICompatible({
    name: "meta",
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    supportsStructuredOutputs: true,
    fetch: options.fetch,
  });
  return createAiSdkProvider("meta", meta.chatModel(options.agentModel), meta.chatModel(options.visionModel));
}

/** Gemini, the fallback when `LLM_PROVIDER=google`. The env loader requires its own model IDs. */
export function createGoogleProvider(options: { apiKey?: string; agentModel: string; visionModel: string }): LlmProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return createAiSdkProvider("google", google(options.agentModel), google(options.visionModel));
}
