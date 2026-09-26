import "server-only";
import { AgentStatusEvent, type ToolName, TRIP_EVENTS } from "@agp/shared";
import type { AdminClient } from "@/lib/supabase/admin";

/** Sends one `agent.status` event to a trip's channel. Best effort: it never fails a run. */
export type Broadcast = (tripId: string, event: AgentStatusEvent) => Promise<void>;

/** What the status bar says while each tool runs. */
export const TOOL_LABELS: Record<ToolName, string> = {
  search_places: "Searching places",
  plan_day: "Optimizing the day",
  update_item: "Updating the itinerary",
  summarize: "Summarizing the trip",
  propose_purchase: "Preparing the approval",
};

/**
 * Broadcasts over the service connection with Realtime's HTTP endpoint, so the runner needn't hold
 * a socket open (design §6). Clients only refetch on these events; they are never state.
 */
export function supabaseBroadcast(admin: AdminClient): Broadcast {
  return async (tripId, event) => {
    const channel = admin.channel(`trip:${tripId}`);
    try {
      const sent = await channel.httpSend(TRIP_EVENTS.agentStatus, AgentStatusEvent.parse(event));
      if (!sent.success) console.warn(`agent.status broadcast failed (${sent.status}): ${sent.error}`);
    } catch (error) {
      console.warn("agent.status broadcast failed", error);
    } finally {
      await admin.removeChannel(channel);
    }
  };
}
