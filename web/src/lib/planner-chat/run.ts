import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, streamText, tool, type ModelMessage } from "ai";
import { AppError } from "@/lib/reliability";
import { isAbortError, plannerFailureMessage } from "./failure";
import { decideReply, offerRecommendation, RETRY_INSTRUCTION, SAFE_LINE } from "./ground";
import { modelMessages, PLANNER_INSTRUCTIONS, tripContext } from "./prompt";
import { flightSearchSchema, hotelSearchSchema, stayAreaSchema, type ChatRequest } from "./schema";
import {
  executeFlightSearch,
  executeHotelSearch,
  flightModelText,
  hotelModelText,
  noteStayArea,
  stayAreaModelText,
  type SearchDeps,
} from "./search";
import {
  CHAT_UNAVAILABLE,
  type HotelOffer,
  type PlannerChatEvent,
  type PlannerChatResult,
  type StayArea,
} from "./types";
import type { FlightOffer } from "@/lib/providers/flights/types";

const DEFAULT_MODEL = "muse-spark-1.3";
const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
const MAX_STEPS = 4;
const MAX_OUTPUT_TOKENS = 320;
const STEP_MS = 20_000;
const RUN_MS = 45_000;

export interface PlannerRunOptions extends SearchDeps {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  signal?: AbortSignal;
}

export function runPlannerChat(input: ChatRequest, options: PlannerRunOptions): Response {
  if (!options.apiKey) throw new AppError("provider_unavailable", CHAT_UNAVAILABLE);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlannerChatEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await streamPlanner(input, options, send);
        send({ type: "done" });
      } catch (error) {
        if (!isAbortError(error) && !options.signal?.aborted) {
          send({ type: "error", message: plannerFailureMessage(error) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

async function streamPlanner(
  input: ChatRequest,
  options: PlannerRunOptions,
  send: (event: PlannerChatEvent) => void,
): Promise<void> {
  const meta = createOpenAICompatible({
    name: "meta",
    apiKey: options.apiKey,
    baseURL: options.baseURL || DEFAULT_BASE_URL,
    supportsStructuredOutputs: true,
    fetch: options.fetchImpl,
  });
  const deps: SearchDeps = options;
  const cards: PlannerChatResult = { text: "", flights: [], hotels: [] };
  const covered = { flights: false, hotels: false };
  let hotelGap: string | null = null;
  const tools = {
    note_stay_area: tool({
      description: "Record a stay neighborhood, area, or city. No prices.",
      inputSchema: stayAreaSchema,
      execute: (params) => noteStayArea(params.place, deps),
      toModelOutput: ({ output }) => ({ type: "text", value: stayAreaModelText(output) }),
    }),
    search_flights: tool({
      description: "Duffel flights. City or IATA. Pass nonstop, cabin, and departure window when stated.",
      inputSchema: flightSearchSchema,
      execute: (params) => executeFlightSearch(params, deps),
      toModelOutput: ({ output }) => ({ type: "text", value: flightModelText(output) }),
    }),
    search_hotels: tool({
      description: "Duffel hotels in the chosen area.",
      inputSchema: hotelSearchSchema,
      execute: (params) => executeHotelSearch(params, deps),
      toModelOutput: ({ output }) => ({ type: "text", value: hotelModelText(output) }),
    }),
  };
  const messages: ModelMessage[] = modelMessages(input.messages);
  const instructions = `${PLANNER_INSTRUCTIONS}\n\n${tripContext(input.trip)}`;
  let searched = false;

  const collect = (extra?: string) =>
    collectTurn({
      model: meta.chatModel(options.model || DEFAULT_MODEL),
      instructions: extra ? `${instructions}\n\n${extra}` : instructions,
      messages,
      tools,
      signal: options.signal,
      onStatus: (text) => send({ type: "status", text }),
      onCards: () => send({ type: "cards", flights: cards.flights, hotels: cards.hotels }),
      onArea: (area) => send({ type: "stayArea", ...area }),
      cards,
      markSearched: (toolName: string, ok: boolean) => {
        if (toolName === "search_hotels" && !ok) return;
        searched = true;
        if (toolName === "search_flights") covered.flights = true;
        if (toolName === "search_hotels") covered.hotels = true;
      },
      onHotelResult: (output: unknown) => {
        hotelGap = hotelGapFrom(output);
      },
    });

  const first = await collect();
  let decision = decideReply(first, searched, cards.flights, cards.hotels);
  if (decision.action === "retry") {
    const second = await collect(RETRY_INSTRUCTION);
    decision = decideReply(second, searched, cards.flights, cards.hotels);
    if (decision.action === "retry") decision = { action: "send", text: SAFE_LINE };
  }
  const filledGap = await fillTripSearches(input.trip, deps, covered, cards, send);
  if (filledGap !== undefined) hotelGap = filledGap;
  const recommendation = offerRecommendation(cards.flights, cards.hotels);
  const lead = recommendation || decision.text.trim() || SAFE_LINE;
  const text = hotelGap && cards.hotels.length === 0 ? `${lead} ${hotelGap}` : lead;
  send({ type: "text", delta: text });
}

interface CollectInput {
  model: Parameters<typeof streamText>[0]["model"];
  instructions: string;
  messages: ModelMessage[];
  tools: Parameters<typeof streamText>[0]["tools"];
  signal?: AbortSignal;
  onStatus: (text: string) => void;
  onCards: () => void;
  onArea: (area: StayArea) => void;
  cards: { flights: FlightOffer[]; hotels: HotelOffer[] };
  markSearched: (toolName: string, ok: boolean) => void;
  onHotelResult: (output: unknown) => void;
}

async function collectTurn(input: CollectInput): Promise<string> {
  const result = streamText({
    model: input.model,
    instructions: input.instructions,
    messages: input.messages,
    tools: input.tools,
    toolChoice: "auto",
    stopWhen: [isStepCount(MAX_STEPS)],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: { stepMs: STEP_MS, totalMs: RUN_MS },
    abortSignal: input.signal,
    onToolExecutionStart: ({ toolCall }) => {
      const text = statusFor(toolCall.toolName);
      if (text) input.onStatus(text);
    },
    onToolExecutionEnd: ({ toolCall, toolOutput }) => {
      if (toolOutput.type !== "tool-result") return;
      if (toolCall.toolName === "search_flights" || toolCall.toolName === "search_hotels") {
        const ok = (toolOutput.output as { ok?: boolean } | null)?.ok === true;
        input.markSearched(toolCall.toolName, ok);
        if (toolCall.toolName === "search_hotels") input.onHotelResult(toolOutput.output);
      }
      const area = stayAreaFrom(toolCall.toolName, toolOutput.output);
      if (area) input.onArea(area);
      if (!absorb(toolCall.toolName, toolOutput.output, input.cards)) return;
      input.onCards();
    },
  });

  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
    else if (part.type === "error") throw part.error;
    else if (part.type === "abort") return text;
  }
  return text;
}

function stayAreaFrom(toolName: string, output: unknown): StayArea | null {
  const body = output as { ok?: boolean; label?: string; lat?: number; lng?: number; area?: StayArea };
  if (body?.ok !== true) return null;
  if (toolName === "note_stay_area" && body.label && body.lat != null && body.lng != null) {
    return { label: body.label, lat: body.lat, lng: body.lng };
  }
  if (toolName === "search_hotels" && body.area) return body.area;
  return null;
}

function statusFor(toolName: string): string | null {
  if (toolName === "search_flights") return "Searching flights…";
  if (toolName === "search_hotels") return "Searching hotels…";
  return null;
}

function absorb(toolName: string, output: unknown, cards: { flights: FlightOffer[]; hotels: HotelOffer[] }): boolean {
  const body = output as { ok?: boolean; flights?: FlightOffer[]; hotels?: HotelOffer[] };
  if (body?.ok !== true) return false;
  if (toolName === "search_flights" && body.flights) {
    cards.flights = body.flights;
    return true;
  }
  if (toolName === "search_hotels" && body.hotels) {
    cards.hotels = body.hotels;
    return true;
  }
  return false;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** When the model does not search, look up the trip draft and still recommend. Undefined means hotels were not attempted. */
async function fillTripSearches(
  trip: ChatRequest["trip"],
  deps: SearchDeps,
  covered: { flights: boolean; hotels: boolean },
  cards: { flights: FlightOffer[]; hotels: HotelOffer[] },
  send: (event: PlannerChatEvent) => void,
): Promise<string | null | undefined> {
  const origin = trip?.origin?.trim() ?? "";
  const destination = trip?.destination?.trim() ?? "";
  const start = isoDate(trip?.startDate);
  const end = isoDate(trip?.endDate);
  const travelers = travelerCount(trip?.members);

  if (!covered.flights && origin.length >= 2 && destination.length >= 2 && start) {
    send({ type: "status", text: "Searching flights…" });
    const result = await executeFlightSearch(
      {
        origin,
        destination,
        departureDate: start,
        ...(end && end > start ? { returnDate: end } : {}),
        travelers,
        cabinClass: "economy",
      },
      deps,
    );
    covered.flights = true;
    if (absorb("search_flights", result, cards)) send({ type: "cards", flights: cards.flights, hotels: cards.hotels });
  }

  if (covered.hotels || destination.length < 2 || !start) return undefined;
  const checkOut = end && end > start ? end : dayAfter(start);
  send({ type: "status", text: "Searching hotels…" });
  const result = await executeHotelSearch(
    { destination, checkIn: start, checkOut, guests: travelers, rooms: 1 },
    deps,
  );
  if (result.ok) covered.hotels = true;
  const area = stayAreaFrom("search_hotels", result);
  if (area) send({ type: "stayArea", ...area });
  if (absorb("search_hotels", result, cards)) send({ type: "cards", flights: cards.flights, hotels: cards.hotels });
  return hotelGapFrom(result);
}

function hotelGapFrom(output: unknown): string | null {
  const body = output as { ok?: boolean; error?: string; hotels?: unknown[]; note?: string };
  if (body?.ok === true && Array.isArray(body.hotels) && body.hotels.length > 0) return null;
  if (body?.ok === true) return body.note || "No hotels matched that search.";
  if (body?.ok === false && body.error) return body.error;
  return null;
}

function isoDate(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return ISO_DATE.test(trimmed) ? trimmed : null;
}

function dayAfter(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function travelerCount(members: string[] | undefined): number {
  const count = members?.map((name) => name.trim()).filter(Boolean).length ?? 0;
  return Math.min(9, Math.max(1, count));
}
