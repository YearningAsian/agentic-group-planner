/**
 * WAV for voice notes (ADR 0018): the browser records, resamples to 16 kHz mono, and encodes 16-bit
 * PCM with `toWav`; the server checks the header with `parseWav` before anything is transcribed.
 * Pure and client-safe.
 */

const HEADER_BYTES = 44;

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file with the canonical 44-byte header. */
export function toWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 32_767), true);
  });
  return bytes;
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  /** The first channel, as floats in -1..1. */
  samples: Float32Array;
}

class NotWavError extends Error {
  override readonly name = "NotWavError";

  constructor(reason: string) {
    super(`Not a PCM WAV file: ${reason}.`);
  }
}

/** Reads a RIFF/WAVE file's format and PCM samples, walking chunks so extra ones (LIST) are skipped. */
export function parseWav(bytes: Uint8Array): ParsedWav {
  if (bytes.byteLength < HEADER_BYTES) throw new NotWavError("too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new NotWavError("no RIFF/WAVE header");

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) throw new NotWavError("data before fmt");
      if (format.audioFormat !== 1 || format.bitsPerSample !== 16) throw new NotWavError("not 16-bit PCM");
      const length = Math.min(size, bytes.byteLength - body);
      const frames = Math.floor(length / (2 * format.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * 2 * format.channels, true) / 32_767;
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitsPerSample: format.bitsPerSample,
        durationMs: Math.round((frames / format.sampleRate) * 1000),
        samples,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new NotWavError("no data chunk");
}
