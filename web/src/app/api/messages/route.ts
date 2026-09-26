import { messages } from "@agp/shared";
import { after } from "next/server";
import { sendMessage } from "@/features/chat/server";
import { startAgentRun } from "@/lib/agent";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

// An @agent message runs the agent after the response, inside this function's time budget.
export const maxDuration = 300;

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/** Posts a member's message; an @agent mention queues a run that starts once the response is sent. */
export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("The request body must be JSON.");
  }
  const parsed = messages.SendMessageRequest.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(`${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }

  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to send messages.");
    const { client_id, trip_id, body, item_id } = parsed.data;
    const result = await sendMessage(client, { tripId: trip_id, clientId: client_id, body, itemId: item_id });
    const runId = result.agentRunId;
    if (runId) after(() => startAgentRun(runId));
    return Response.json({ message_id: result.messageId, agent_run_id: runId } satisfies messages.SendMessageResponse);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
