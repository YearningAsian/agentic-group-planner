import { z } from "zod";

/** `POST /api/voice-notes` form fields besides the audio (design §2.5). */
export const VoiceNoteFields = z.object({
  trip_id: z.uuid(),
  /** Like a typed message: a retried upload with the same ID posts once. */
  client_id: z.uuid(),
});
export type VoiceNoteFields = z.infer<typeof VoiceNoteFields>;

export const VoiceNoteResponse = z.object({
  message_id: z.uuid(),
  agent_run_id: z.uuid().nullable(),
  transcript: z.string(),
});
export type VoiceNoteResponse = z.infer<typeof VoiceNoteResponse>;

/** 16 kHz mono 16-bit PCM, at most 2 minutes (the composer's limit). */
export const VOICE_NOTE_LIMITS = { sampleRate: 16_000, channels: 1, maxDurationMs: 120_000 } as const;
