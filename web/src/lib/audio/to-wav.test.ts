import { describe, expect, it } from "vitest";
import { parseWav, toWav } from "./to-wav";

describe("toWav", () => {
  it("toWav writes a 44-byte header for 16 kHz, mono, 16-bit, and a 1 kHz sine round-trips within one sample", () => {
    const rate = 16_000;
    const sine = Float32Array.from({ length: rate / 10 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate));

    const wav = toWav(sine, rate);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(wav.byteLength).toBe(44 + sine.length * 2);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(new TextDecoder().decode(wav.subarray(36, 40))).toBe("data");

    const parsed = parseWav(wav);
    expect(parsed).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, durationMs: 100 });
    const oneSample = 1 / 32_767;
    for (let i = 0; i < sine.length; i++) expect(Math.abs(parsed.samples[i]! - sine[i]!)).toBeLessThanOrEqual(oneSample);
  });

  it("clamps samples outside -1..1 instead of wrapping", () => {
    const parsed = parseWav(toWav(Float32Array.from([2, -2, 0]), 16_000));
    expect(Array.from(parsed.samples).map((v) => Math.round(v))).toEqual([1, -1, 0]);
  });

  it("parseWav rejects anything that isn't PCM WAV", () => {
    expect(() => parseWav(new TextEncoder().encode("ID3 not a wav at all, just some bytes here"))).toThrow(/WAV/);
    expect(() => parseWav(new Uint8Array(10))).toThrow(/WAV/);
  });
});
