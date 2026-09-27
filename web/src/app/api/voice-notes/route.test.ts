import { beforeEach, describe, expect, it, vi } from "vitest";
import { toWav } from "@/lib/audio/to-wav";

const sendMessage = vi.fn();
const startAgentRun = vi.fn();
const after = vi.fn();
const transcribe = vi.fn();
const getUser = vi.fn();
const member = vi.fn();

vi.mock("@/features/chat/server", () => ({ sendMessage }));
vi.mock("@/lib/agent", () => ({ startAgentRun }));
vi.mock("@/lib/providers/transcription", () => ({ getTranscriptionProvider: () => ({ name: "mock", transcribe }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after }));
vi.mock("@/lib/supabase/server", () => ({
  getServerClient: async () => ({
    auth: { getUser },
    // The two reads the route makes: the caller's membership, and the trip's venue names.
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        maybeSingle: async () => member(),
        then: (resolve: (v: unknown) => unknown) =>
          resolve(table === "item_options" ? { data: [{ place: { name: "Georgia Aquarium" } }], error: null } : { data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { POST } = await import("./route");

const ids = { trip_id: "00000000-0000-4000-8000-000000000100", client_id: "00000000-0000-4000-8000-000000000001" };

function upload(wav: Uint8Array, fields: Record<string, string> = ids) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("audio", new Blob([wav.slice()], { type: "audio/wav" }), "note.wav");
  return POST(new Request("http://localhost/api/voice-notes", { method: "POST", body: form }));
}

/** A WAV with the given format, written by hand so stereo and 44.1 kHz can be built too. */
function wavWith({ rate = 16_000, channels = 1, seconds = 1 }) {
  const frames = rate * seconds;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (o: number, t: string) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  return bytes;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  member.mockResolvedValue({ data: { id: "member-1" }, error: null });
  transcribe.mockResolvedValue({ text: "Sounds good to me.", durationMs: 1000 });
  sendMessage.mockResolvedValue({ messageId: "00000000-0000-4000-8000-0000000000aa", agentRunId: null });
});

describe("POST /api/voice-notes", () => {
  it("the route rejects a non-WAV, stereo, 44.1 kHz, or over-2-minute upload with 400 before calling the provider", async () => {
    const bad = [
      new TextEncoder().encode("ID3 an mp3, not a wav, with enough bytes to pass the length check"),
      wavWith({ channels: 2 }),
      wavWith({ rate: 44_100 }),
      wavWith({ seconds: 121 }),
    ];
    for (const wav of bad) {
      const response = await upload(wav);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_input");
    }
    expect(transcribe).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("the transcript posts through sendMessage with the upload's client_id, so a retried upload posts once", async () => {
    const wav = toWav(new Float32Array(16_000), 16_000);
    const response = await upload(wav);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message_id: "00000000-0000-4000-8000-0000000000aa", agent_run_id: null, transcript: "Sounds good to me." });
    expect(transcribe).toHaveBeenCalledWith({ wav: expect.any(Uint8Array), keywords: ["Georgia Aquarium"] });
    expect(sendMessage).toHaveBeenCalledWith(expect.anything(), { tripId: ids.trip_id, clientId: ids.client_id, body: "Sounds good to me." });
  });

  it('a transcript with "@agent" starts one agent run', async () => {
    transcribe.mockResolvedValue({ text: "@agent can we make lunch cheaper?", durationMs: 2000 });
    sendMessage.mockResolvedValue({ messageId: "00000000-0000-4000-8000-0000000000bb", agentRunId: "00000000-0000-4000-8000-0000000000cc" });

    const response = await upload(toWav(new Float32Array(32_000), 16_000));

    expect((await response.json()).agent_run_id).toBe("00000000-0000-4000-8000-0000000000cc");
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]![0]();
    expect(startAgentRun).toHaveBeenCalledWith("00000000-0000-4000-8000-0000000000cc");
  });

  it("a non-member is refused before anything is transcribed", async () => {
    member.mockResolvedValue({ data: null, error: null });
    const response = await upload(toWav(new Float32Array(16_000), 16_000));
    expect(response.status).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
