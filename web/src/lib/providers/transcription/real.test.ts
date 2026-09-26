import { describe, expect, it } from "vitest";
import { toWav } from "@/lib/audio/to-wav";
import { createMetaTranscription } from "./real";

describe("the Meta transcription provider", () => {
  it("the real provider sends multipart request JSON (model, keywords) and the WAV, and parses the transcript", async () => {
    const seen: { url: string; auth: string | null; form: FormData }[] = [];
    const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), form: init?.body as FormData });
      return Response.json({ text: "@agent can we make lunch cheaper?", duration_ms: 2400 });
    };
    const wav = toWav(new Float32Array(16_000), 16_000);

    const provider = createMetaTranscription({ apiKey: "test-key", baseURL: "https://meta.test/v1", model: "muse-voice-transcribe-1.0", fetch });
    const transcript = await provider.transcribe({ wav, keywords: ["Georgia Aquarium", "Piedmont Park"] });

    expect(transcript).toEqual({ text: "@agent can we make lunch cheaper?", durationMs: 2400 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://meta.test/v1/asr/transcribe");
    expect(seen[0]!.auth).toBe("Bearer test-key");
    expect(JSON.parse(String(seen[0]!.form.get("request")))).toEqual({
      model: "muse-voice-transcribe-1.0",
      keywords: ["Georgia Aquarium", "Piedmont Park"],
    });
    const audio = seen[0]!.form.get("audio") as File;
    expect(audio.type).toBe("audio/wav");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(wav);
  });

  it("a 5xx is retried once, then surfaces provider_unavailable; the key never appears in errors", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Response("upstream down", { status: 503 });
    };
    const provider = createMetaTranscription({ apiKey: "secret-key", baseURL: "https://meta.test/v1", model: "m", fetch, backoffMs: 1 });

    const error = await provider.transcribe({ wav: toWav(new Float32Array(160), 16_000) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    expect(JSON.stringify(error)).not.toContain("secret-key");
    expect(calls).toBe(2);
  });
});
