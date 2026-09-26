import type { RunTrigger } from "@agp/shared";

/** A server-triggered run has no prompt, so its recording is keyed by what started it. */
export interface TriggerKey {
  trigger: RunTrigger;
  slotKey: string;
}

/**
 * The key a recorded agent run is stored and replayed under (design §7.5). A prompt is lowercased,
 * with `@agent` removed, punctuation stripped, and whitespace collapsed, so the same request typed
 * slightly differently replays the same recording.
 */
export function recordingKey(source: string | TriggerKey): string {
  if (typeof source !== "string") return `${source.trigger}:${source.slotKey.toLowerCase()}`;
  return source
    .toLowerCase()
    .replace(/@agent\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The recording's file name under `scripts/demo/fixtures/agent-recordings/`. */
export function recordingFileName(key: string): string {
  return `${key.replace(/[^a-z0-9_]/g, "-")}.json`;
}
