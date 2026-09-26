import { voiceNotes } from "@agp/shared";
import { after } from "next/server";
import { sendMessage } from "@/features/chat/server";
import { startAgentRun } from "@/lib/agent";
import { parseWav } from "@/lib/audio/to-wav";
import { getTranscriptionProvider } from "@/lib/providers/transcription";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

// A transcript that mentions @agent runs the agent after the response, like a typed message.
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 44 + voiceNotes.VOICE_NOTE_LIMITS.maxDurationMs * 32 + 4096;

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/**
 * A voice note in the trip chat (design §2.5): checks the WAV, transcribes it with the trip's venue
 * names as keywords, and posts the transcript as the member's own message through `sendMessage`.
 * The audio isn't stored. Uploads that aren't 16 kHz mono PCM, or run over 2 minutes, are refused
 * before anything is transcribed.
 */
export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Send multipart form data with trip_id, client_id, and audio.");
  }
  const fields = voiceNotes.VoiceNoteFields.safeParse({ trip_id: form.get("trip_id"), client_id: form.get("client_id") });
  if (!fields.success) return badRequest("trip_id and client_id must be UUIDs.");
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return badRequest("audio must be a WAV file.");
  if (audio.size > MAX_UPLOAD_BYTES) return badRequest("Voice notes can be at most 2 minutes.");

  const wav = new Uint8Array(await audio.arrayBuffer());
  let parsed;
  try {
    parsed = parseWav(wav);
  } catch {
    return badRequest("audio must be a 16-bit PCM WAV file.");
  }
  const { sampleRate, channels, maxDurationMs } = voiceNotes.VOICE_NOTE_LIMITS;
  if (parsed.sampleRate !== sampleRate || parsed.channels !== channels) return badRequest("audio must be 16 kHz mono.");
  if (parsed.durationMs > maxDurationMs) return badRequest("Voice notes can be at most 2 minutes.");

  try {
    const client = await getServerClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) throw new AppError("unauthenticated", "Sign in to send voice notes.");
    const { trip_id: tripId, client_id: clientId } = fields.data;

    // Check membership first, so nobody's speech is transcribed (and paid for) on a trip they're not in.
    const member = await client
      .from("trip_members")
      .select("id")
      .eq("trip_id", tripId)
      .eq("profile_id", auth.user.id)
      .eq("status", "joined")
      .maybeSingle();
    if (!member.data) throw new AppError("not_permitted", "You're not a member of this trip.");

    const places = await client.from("item_options").select("place:places(name)").eq("trip_id", tripId);
    const keywords = [...new Set((places.data ?? []).flatMap((o) => (o.place?.name ? [o.place.name] : [])))];
    const transcript = await getTranscriptionProvider().transcribe({ wav, keywords });
    if (!transcript.text) throw new AppError("domain_rule", "We couldn't hear anything in that recording.");

    const result = await sendMessage(client, { tripId, clientId, body: transcript.text.slice(0, 2000) });
    const runId = result.agentRunId;
    if (runId) after(() => startAgentRun(runId));
    return Response.json({
      message_id: result.messageId,
      agent_run_id: runId,
      transcript: transcript.text,
    } satisfies voiceNotes.VoiceNoteResponse);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
