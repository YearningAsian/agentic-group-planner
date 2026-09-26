import "server-only";
import { z } from "zod";
import { AppError, withPolicy } from "@/lib/reliability";
import type { TranscriptionProvider } from "./types";

// Design §7.4: a voice note gets 30 s and one retry.
const TIMEOUT_MS = 30_000;
const RETRIES = 1;

/** The answer we rely on; the endpoint may send more. `duration_ms` is optional. */
const Transcript = z.object({ text: z.string(), duration_ms: z.number().int().min(0).optional() });

class TranscriptionHttpError extends Error {
  override readonly name = "TranscriptionHttpError";

  constructor(readonly status: number) {
    super(`Meta's speech-to-text answered ${status}.`);
  }
}

export interface MetaTranscriptionOptions {
  apiKey?: string;
  baseURL: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  backoffMs?: number;
}

/**
 * Meta's speech to text: `POST {base}/asr/transcribe`, multipart with a `request` JSON part
 * (model and keywords) and the `audio` WAV part (design §2.5, stack.md). The keywords bias it toward
 * the trip's venue names.
 */
export function createMetaTranscription(options: MetaTranscriptionOptions): TranscriptionProvider {
  const fetch = options.fetch ?? globalThis.fetch;
  const url = `${options.baseURL.replace(/\/$/, "")}/asr/transcribe`;
  return {
    name: "real",
    async transcribe({ wav, keywords }) {
      const body = await withPolicy(
        async (signal) => {
          const form = new FormData();
          form.set("request", JSON.stringify({ model: options.model, ...(keywords?.length ? { keywords } : {}) }));
          form.set("audio", new Blob([wav.slice()], { type: "audio/wav" }), "voice-note.wav");
          const response = await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${options.apiKey ?? ""}` },
            body: form,
            signal,
          });
          if (!response.ok) throw new TranscriptionHttpError(response.status);
          return response.json();
        },
        { timeoutMs: TIMEOUT_MS, retries: RETRIES, backoffMs: options.backoffMs },
      ).catch((error: unknown) => {
        if (error instanceof TranscriptionHttpError) {
          throw new AppError("internal", "Speech to text rejected the recording.", { retryable: false, cause: error });
        }
        throw error;
      });
      const parsed = Transcript.safeParse(body);
      if (!parsed.success) throw new AppError("internal", "Speech to text sent an answer we can't read.", { retryable: false });
      return { text: parsed.data.text.trim(), durationMs: parsed.data.duration_ms ?? 0 };
    },
  };
}
