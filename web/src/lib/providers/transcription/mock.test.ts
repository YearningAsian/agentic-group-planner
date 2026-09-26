import { describe, expect, it } from "vitest";
import { toWav } from "@/lib/audio/to-wav";
import { createMockTranscription } from "./mock";

describe("the mock transcription provider", () => {
  it("returns a fixture transcript by recording length, and the length it measured", async () => {
    const mock = createMockTranscription();
    const seconds = (n: number) => toWav(new Float32Array(16_000 * n), 16_000);

    expect(await mock.transcribe({ wav: seconds(2) })).toEqual({ text: "Sounds good to me.", durationMs: 2000 });
    expect((await mock.transcribe({ wav: seconds(6) })).text).toContain("@agent");
    expect(await mock.transcribe({ wav: seconds(6) })).toEqual(await mock.transcribe({ wav: seconds(6) }));
  });
});
