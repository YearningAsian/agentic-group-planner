import "server-only";
import { parseWav } from "@/lib/audio/to-wav";
import type { TranscriptionProvider } from "./types";

/** Fixture transcripts by length, so tests and offline development get stable text. */
const FIXTURES: [maxSeconds: number, text: string][] = [
  [3, "Sounds good to me."],
  [10, "@agent can we make lunch cheaper?"],
  [Number.POSITIVE_INFINITY, "Can we find somewhere with vegetarian options for dinner, near Midtown?"],
];

/** Deterministic and offline: never touches the network (design §2.3). */
export function createMockTranscription(): TranscriptionProvider {
  return {
    name: "mock",
    async transcribe({ wav }) {
      const { durationMs } = parseWav(wav);
      const text = FIXTURES.find(([max]) => durationMs / 1000 <= max)![1];
      return { text, durationMs };
    },
  };
}
