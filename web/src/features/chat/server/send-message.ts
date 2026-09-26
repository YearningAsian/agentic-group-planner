import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import type { ServerClient } from "@/lib/supabase/server";

export interface SendMessageInput {
  tripId: string;
  clientId: string;
  body: string;
  /** Set for a comment on an itinerary item. */
  itemId?: string;
}

export interface SendMessageResult {
  messageId: string;
  /** The queued run when the body mentions @agent; the route starts it after responding. */
  agentRunId: string | null;
}

/** "@agent" as a whole word, in any case: not part of an email address or a longer name. */
export function mentionsAgent(body: string): boolean {
  return /(?<![\w@.])@agent(?![\w-])/i.test(body);
}

function dbError(message: string, cause: unknown): AppError {
  return new AppError("internal", message, { retryable: true, cause });
}

/**
 * Posts a member's message (design §5.2). The insert runs as the member, so row-level security
 * decides who may post and where; an item comment must name an item on the same trip. The same
 * `clientId` always returns the same message, so a retry or a double tap posts once. A body that
 * mentions @agent queues exactly one agent run, keyed by the message (design §7.1).
 */
export async function sendMessage(
  client: ServerClient,
  input: SendMessageInput,
  admin: AdminClient = getAdminClient(),
): Promise<SendMessageResult> {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new AppError("unauthenticated", "Sign in to send messages.");

  // Row-level security shows only trips the caller is in, so a non-member finds no row.
  const { data: member, error: memberError } = await client
    .from("trip_members")
    .select("id")
    .eq("trip_id", input.tripId)
    .eq("profile_id", auth.user.id)
    .eq("status", "joined")
    .maybeSingle();
  if (memberError) throw dbError("Couldn't check your membership.", memberError);
  if (!member) throw new AppError("not_permitted", "You're not a member of this trip.");

  let message: { id: string; mentions_agent: boolean };
  const inserted = await client
    .from("messages")
    .insert({
      trip_id: input.tripId,
      sender_type: "member",
      sender_member_id: member.id,
      kind: "text",
      body: input.body,
      item_id: input.itemId ?? null,
      client_id: input.clientId,
      mentions_agent: mentionsAgent(input.body),
    })
    .select("id, mentions_agent")
    .single();
  if (inserted.error?.code === "23505") {
    // A retry of an earlier send: return that message, but only if it's this member's, on this trip.
    const { data: existing, error } = await client
      .from("messages")
      .select("id, trip_id, sender_member_id, mentions_agent")
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (error) throw dbError("Couldn't read the message.", error);
    if (!existing || existing.trip_id !== input.tripId || existing.sender_member_id !== member.id) {
      throw new AppError("conflict", "That message ID was already used. Send it again.");
    }
    message = existing;
  } else if (inserted.error?.code === "42501") {
    throw new AppError("not_permitted", "That item isn't on this trip.");
  } else if (inserted.error) {
    throw dbError("Couldn't send the message.", inserted.error);
  } else {
    message = inserted.data;
  }

  if (!message.mentions_agent) return { messageId: message.id, agentRunId: null };

  const env = getServerEnv();
  const run = await admin
    .from("agent_runs")
    .insert({
      trip_id: input.tripId,
      trigger: "mention",
      trigger_message_id: message.id,
      requester_member_id: member.id,
      provider: env.LLM_PROVIDER,
      model: env.AGENT_MODEL,
    })
    .select("id")
    .single();
  if (run.error?.code === "23505") {
    const { data: existing, error } = await admin.from("agent_runs").select("id").eq("trigger_message_id", message.id).single();
    if (error) throw dbError("Couldn't read the agent run.", error);
    return { messageId: message.id, agentRunId: existing.id };
  }
  if (run.error) throw dbError("Couldn't start the agent.", run.error);
  return { messageId: message.id, agentRunId: run.data.id };
}
