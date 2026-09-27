import type { ModelMessage } from "ai";
import type { ChatRequest } from "./schema";

export const PLANNER_INSTRUCTIONS = `You are the trip agent in a group travel planner. You find real flights and hotels from Duffel.

Every reply recommends one flight and one hotel. Do not ask for more details first. Search this turn with the trip draft.

- Call search_flights with origin, destination, departure date, and travelers. Use economy unless another cabin was asked. Pass nonstop or a departure window when stated. Omit the return date for one-way.
- Call search_hotels with the stay area, check-in, check-out, and guests.
- Call note_stay_area when they name a neighborhood, area, or city. That records the place only.
- Recommend the cheapest nonstop, or the cheapest flight if none are nonstop, and the best-rated hotel. Use only airline, times, stops, prices, names, and amenities from tool results.
- If a tool errors or finds nothing, say that. Do not invent a substitute.
- When preferences conflict, describe the tradeoff from the options returned. Do not pick a side.`;

const KEPT_TURNS = 8;
const OLDER_CLIP = 160;

export function modelMessages(messages: ChatRequest["messages"]): ModelMessage[] {
  const kept = messages.slice(-KEPT_TURNS);
  const last = kept.length - 1;
  return kept.map((message, index) => ({
    role: message.role,
    content: index === last ? message.text : message.text.slice(0, OLDER_CLIP),
  }));
}

export function tripContext(trip: ChatRequest["trip"]): string {
  if (!trip) return "Trip draft: none.";
  const members = (trip.members ?? []).map((name) => name.trim()).filter(Boolean);
  const lines = [
    trip.destination?.trim() ? `Destination: ${trip.destination.trim()}` : "",
    trip.origin?.trim() ? `Origin: ${trip.origin.trim()}` : "",
    trip.startDate?.trim() && trip.endDate?.trim()
      ? `Dates: ${trip.startDate.trim()} to ${trip.endDate.trim()}`
      : "",
    trip.budget != null ? `Budget: ${trip.budget}/person` : "",
    members.length > 0 ? `Travelers: ${members.join(", ")} (${members.length})` : "",
  ].filter(Boolean);
  if (lines.length === 0) return "Trip draft: none.";
  return `Trip draft:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}
