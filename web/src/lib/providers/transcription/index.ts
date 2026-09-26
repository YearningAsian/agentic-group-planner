import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { createMockTranscription } from "./mock";
import { createMetaTranscription } from "./real";
import type { TranscriptionProvider } from "./types";

export type * from "./types";

let cached: TranscriptionProvider | undefined;

/** Picks Meta's speech to text or the mock from `TRANSCRIBE_PROVIDER` (mock by default). */
export function getTranscriptionProvider(): TranscriptionProvider {
  const env = getServerEnv();
  cached ??=
    env.TRANSCRIBE_PROVIDER === "real"
      ? createMetaTranscription({ apiKey: env.META_MODEL_API_KEY, baseURL: env.META_MODEL_API_BASE_URL, model: env.TRANSCRIBE_MODEL })
      : createMockTranscription();
  return cached;
}
