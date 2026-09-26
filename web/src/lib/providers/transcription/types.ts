export type TranscriptionProviderName = "real" | "mock";

export interface TranscribeInput {
  /**
   * A voice note as RIFF/WAVE, 16-bit PCM, mono, 16 kHz: the only input the Meta ASR endpoint
   * takes. The browser converts its recording before upload, and the route checks the header.
   */
  wav: Uint8Array;
  /** Domain words to bias toward, like venue names on the trip. */
  keywords?: string[];
}

export interface Transcript {
  text: string;
  durationMs: number;
}

export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName;
  /** POST /v1/asr/transcribe (multipart: `request` JSON and `audio` WAV). At most 10 minutes or 32 MB. */
  transcribe(input: TranscribeInput): Promise<Transcript>;
}
