import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  isStepCount,
  type LanguageModel,
  type LanguageModelMiddleware,
  Output,
  type StopCondition,
  type ToolSet,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";
import { AppError, withPolicy } from "@/lib/reliability";
import type { LlmProvider, LlmProviderName } from "./types";

// Design §7.4: each model call gets 25 s and one retry; a whole run gets 90 s. The budget is per
// model call, not per SDK step, because a step also runs its tools (plan_day alone may take 16 s).
const MODEL_CALL_MS = 25_000;
const RUN_MS = 90_000;
const MODEL_RETRIES = 1;
const DEFAULT_MAX_STEPS = 6;

/** The SDK marks 429s, 5xx responses, and dropped connections retryable; withPolicy retries AppErrors. */
function retryableAsAppError(error: unknown): unknown {
  if ((error as { isRetryable?: unknown } | null)?.isRetryable !== true) return error;
  return new AppError("provider_unavailable", "The model isn't responding. Try again.", { retryable: true, cause: error });
}

/** Runs every model request through withPolicy. Only the request is retried, never a tool. */
const modelCallPolicy: LanguageModelMiddleware = {
  wrapGenerate: ({ model, params }) =>
    withPolicy(
      async (signal) => {
        try {
          return await model.doGenerate({
            ...params,
            abortSignal: params.abortSignal ? AbortSignal.any([params.abortSignal, signal]) : signal,
          });
        } catch (error) {
          throw retryableAsAppError(error);
        }
      },
      { timeoutMs: MODEL_CALL_MS, retries: MODEL_RETRIES },
    ),
};

/** A tool that throws ends the run; the SDK would otherwise hand the error to the model and go on. */
const toolFailed: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.content.some((part) => part.type === "tool-error") ?? false;

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
      maxRetries: 0,
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
        stopWhen: [isStepCount(input.maxSteps ?? DEFAULT_MAX_STEPS), toolFailed],
        timeout: { totalMs: RUN_MS },
        maxRetries: 0,
        abortSignal: input.signal,
      });
      const failure = result.steps.at(-1)?.content.find((part) => part.type === "tool-error");
      if (failure) throw failure.error;
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
  return createAiSdkProvider(
    "meta",
    wrapLanguageModel({ model: meta.chatModel(options.agentModel), middleware: modelCallPolicy }),
    wrapLanguageModel({ model: meta.chatModel(options.visionModel), middleware: modelCallPolicy }),
  );
}

/** Gemini, the fallback when `LLM_PROVIDER=google`. The env loader requires its own model IDs. */
export function createGoogleProvider(options: { apiKey?: string; agentModel: string; visionModel: string }): LlmProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return createAiSdkProvider(
    "google",
    wrapLanguageModel({ model: google(options.agentModel), middleware: modelCallPolicy }),
    wrapLanguageModel({ model: google(options.visionModel), middleware: modelCallPolicy }),
  );
}
