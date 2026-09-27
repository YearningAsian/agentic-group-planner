"use client";

/**
 * `/studio` split view inside `AppShell`: chat and stay cards on the left, `TripMap` on the right.
 * Opened from `EntryChoice` Chat and from `OnboardingFlow.finish()`.
 * A null `destinationId` stays empty; exact city chat messages call `confirmDestination` before fixture stay cards appear.
 * Browse stays and Browse flights read the sample catalog for the trip destination, dates, and budget.
 * A chat `stayArea` opens the stay listing. Chat flight cards remember the origin for later browse.
 * City detect is `chatCityDestination` in `fixtures.ts`. Nightly-vs-budget ranking is `splitStays` here; `/plan` uses nights in `plan-picker.tsx`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Check, ChevronLeft, Heart, Mic, Send, Sparkles, Users } from "lucide-react";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { TripMap } from "@/features/trip-draft/components/trip-map";
import type { MapMarker } from "@/features/trip-draft/components/fallback-map";
import { chatCityDestination, destinationById, findStay, staysFor, type StayOption } from "@/features/trip-draft/fixtures";
import {
  formatMoney,
  formatRange,
  money,
  nightsBetween,
  questionnaireBrief,
  QUESTIONNAIRE_KICKOFF_KEY,
  stayOverBudget,
  validRange,
} from "@/features/trip-draft/format";
import {
  flightExceedsBudget,
  relevantOffers,
  rememberFlightOrigin,
  rememberedFlightOrigin,
  stayExceedsBudget,
} from "@/features/trip-draft/browse-offers";
import type { FlightOffer } from "@/lib/providers/flights/types";
import { offerRecommendation, SAFE_LINE } from "@/lib/planner-chat/ground";
import type { HotelOffer, PlannerChatEvent } from "@/lib/planner-chat/types";
import { FlightResultCards, HotelResultCards } from "@/features/trip-draft/components/travel-result-cards";
import type { StayCard } from "@/lib/providers/stays/types";
import { chosenStayFromHotel } from "@/features/trip-draft/chosen-travel";
import { useTrip } from "@/features/trip-draft/trip-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const PIN_OFFSETS = [
  { lng: 0.018, lat: 0.012 },
  { lng: -0.022, lat: -0.006 },
  { lng: 0.008, lat: -0.016 },
];

const PROMPTS = ["Show something closer to the center", "Anything quieter?", "Raise the nightly target"];

type Line = {
  id: string;
  role: "agent" | "user";
  text: string;
  flights?: FlightOffer[];
  hotels?: HotelOffer[];
  pending?: boolean;
};

function parseChatEvent(line: string): PlannerChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const event = JSON.parse(trimmed) as PlannerChatEvent;
    if (event && typeof event === "object" && "type" in event) return event;
  } catch {
    return null;
  }
  return null;
}

function splitStays(stays: StayOption[], budget: number | null, nights: number) {
  const ranked = [...stays].sort((a, b) => {
    const aOver = stayOverBudget(a.price, nights, budget) ? 1 : 0;
    const bOver = stayOverBudget(b.price, nights, budget) ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return b.rating - a.rating;
  });
  const [best, ...rest] = ranked;
  return { best, rest };
}

function unfitCopy(stay: StayOption, budget: number | null, nights: number) {
  if (stayOverBudget(stay.price, nights, budget) && budget != null) {
    const total = stay.price * nights;
    return {
      tag: "Over budget",
      reason: `${money(stay.price)} a night is ${money(total)} for ${nights} ${nights === 1 ? "night" : "nights"}, over the ${money(budget)} per-person target.`,
    };
  }
  if (stay.rating < 4.85) {
    return {
      tag: "Lower rated",
      reason: `Budget-friendly, but a ${stay.rating} rating and a longer commute from the center.`,
    };
  }
  return {
    tag: "Weaker match",
    reason: `A fine stay in ${stay.neighborhood}. A looser fit for the whole group than the pick above.`,
  };
}

function guestScoreLabel(score: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(score);
}

function cardMeta(stay: StayCard): string {
  return [
    stay.area,
    stay.reviewCount != null ? `${stay.reviewCount} reviews` : null,
    stay.starRating != null ? `${stay.starRating}-star` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function StayBrowseGrid({
  cards,
  status,
  datesReady,
  hasPlace,
  notice,
  selectedId,
  lockedStayId,
  listingHref,
  onChoose,
}: {
  cards: StayCard[];
  status: "idle" | "loading" | "ready" | "error";
  datesReady: boolean;
  hasPlace: boolean;
  notice: string | null;
  selectedId: string;
  lockedStayId: string | null;
  listingHref: (id: string) => string;
  onChoose: (stay: StayCard) => void;
}) {
  let message: string | null = null;
  if (!hasPlace) message = "Tell me where the group wants to stay.";
  else if (!datesReady) message = "Add trip dates to browse stays.";
  else if (status === "loading" || status === "idle") message = "Looking up stays…";
  else if (status === "error") message = "Stays are unavailable right now.";
  else if (cards.length === 0) message = "No stays in this area for those dates.";

  return (
    <ScrollArea className="min-h-0 flex-1">
      {notice && !message ? <p className="px-5 pt-4 text-[14px] text-muted">{notice}</p> : null}
      {message ? (
        <p className="px-5 py-6 text-[14px] text-muted">{message}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
          {cards.map((stay) => {
            const selected = stay.id === selectedId;
            const saved = lockedStayId === stay.id;
            return (
              <li key={stay.id}>
                <article
                  className={cn(
                    "overflow-hidden rounded-[14px] border bg-white shadow-[var(--shadow)]",
                    selected ? "border-accent" : "border-line",
                  )}
                >
                  <a
                    href={listingHref(stay.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${stay.name}`}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-bg-muted">
                      {stay.image ? <img src={stay.image} alt="" className="absolute inset-0 size-full object-cover" /> : null}
                    </div>
                    <div className="p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-[14.5px] font-bold">{stay.name}</h2>
                        {stay.guestScore != null ? (
                          <p className="shrink-0 text-[12.5px] font-semibold tabular-nums" aria-label={`Guest score ${guestScoreLabel(stay.guestScore)}`}>
                            {guestScoreLabel(stay.guestScore)}
                          </p>
                        ) : null}
                      </div>
                      {cardMeta(stay) ? <p className="mt-1 text-[12.5px] text-muted">{cardMeta(stay)}</p> : null}
                      {stay.nightlyAmount != null && stay.currency ? (
                        <p className="mt-2 text-[14px] font-semibold tabular-nums">
                          {formatMoney(stay.nightlyAmount, stay.currency)}{" "}
                          <span className="text-[12px] font-medium text-muted">/ night</span>
                        </p>
                      ) : (
                        <p className="mt-2 text-[13px] text-muted">Price unavailable</p>
                      )}
                    </div>
                  </a>
                  <div className="border-t border-line px-3.5 py-3">
                    <Button
                      type="button"
                      aria-label={saved ? `${stay.name} is on your summary` : `Choose this hotel: ${stay.name}`}
                      disabled={saved}
                      onClick={() => onChoose(stay)}
                      className="h-9 w-full rounded-[9px] bg-accent px-3 text-[12.5px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:translate-y-px disabled:opacity-70"
                    >
                      {saved ? "On your summary" : "Choose this hotel"}
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </ScrollArea>
  );
}

function FlightBrowseList({
  flights,
  status,
  hasOrigin,
  hasDestination,
  datesReady,
  notice,
  selectedId,
  onChoose,
}: {
  flights: FlightOffer[];
  status: "idle" | "loading" | "ready" | "error";
  hasOrigin: boolean;
  hasDestination: boolean;
  datesReady: boolean;
  notice: string | null;
  selectedId: string | null;
  onChoose: (flight: FlightOffer) => void;
}) {
  let message: string | null = null;
  if (!hasDestination) message = "Tell me where the group is flying.";
  else if (!hasOrigin) message = "Tell me where you're flying from.";
  else if (!datesReady) message = "Add trip dates to browse flights.";
  else if (status === "loading" || status === "idle") message = "Looking up flights…";
  else if (status === "error") message = "Flights are unavailable right now.";
  else if (flights.length === 0) message = notice || "No flights matched that search.";

  return (
    <ScrollArea className="min-h-0 flex-1">
      {message ? (
        <p className="px-5 py-6 text-[14px] text-muted">{message}</p>
      ) : (
        <div className="px-5 py-4">
          {notice ? <p className="mb-3 text-[14px] text-muted">{notice}</p> : null}
          <FlightResultCards flights={flights} selectedId={selectedId} onChoose={onChoose} />
        </div>
      )}
    </ScrollArea>
  );
}

export function PlannerStudio() {
  const trip = useTrip();
  const { state } = trip;
  const destination = destinationById(state.destinationId);
  const stays = destination ? staysFor(destination.id) : [];
  const budget = state.budget;
  const nights = nightsBetween(state.startDate, state.endDate);
  const { best } = splitStays(stays, budget, nights);
  const lockedStay = findStay(state.destinationId, state.lockedStayId);
  const featured = lockedStay ?? best;
  const rest = stays.filter((stay) => stay.id !== featured?.id);
  const featuredId = featured?.id ?? "";
  const [selectedId, setSelectedId] = useState(featuredId);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [voiceNoted, setVoiceNoted] = useState(false);
  const [mode, setMode] = useState<"chat" | "stays" | "flights">(() => {
    if (typeof window === "undefined") return "chat";
    const value = new URLSearchParams(window.location.search).get("browse");
    return value === "stays" || value === "flights" ? value : "chat";
  });
  const [fromQuestionnaire, setFromQuestionnaire] = useState(false);
  const [stayArea, setStayArea] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [chatOrigin, setChatOrigin] = useState("");
  const [stayCards, setStayCards] = useState<StayCard[]>([]);
  const [stayStatus, setStayStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [flightCards, setFlightCards] = useState<FlightOffer[]>([]);
  const [flightStatus, setFlightStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [flightNote, setFlightNote] = useState("");
  const [featuredToken, setFeaturedToken] = useState(featuredId);
  const [destinationToken, setDestinationToken] = useState(destination?.id ?? "");
  const [browseToken, setBrowseToken] = useState("");
  const [loadedBrowseKey, setLoadedBrowseKey] = useState("");
  const [flightToken, setFlightToken] = useState("");
  const [loadedFlightKey, setLoadedFlightKey] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const nextLine = useRef(0);
  const clarifyCount = useRef(0);
  const fromQuestionnaireRef = useRef(false);
  const chatAbort = useRef<AbortController | null>(null);
  const chatGeneration = useRef(0);

  // Adjust selection when the featured stay changes (allowed during render; avoids set-state-in-effect).
  if (featuredId !== featuredToken) {
    setFeaturedToken(featuredId);
    setSelectedId(featuredId);
  }
  const browsing = mode === "stays";
  // Close stay browse when the destination clears and chat has not named an area.
  const destinationKey = destination?.id ?? "";
  if (destinationKey !== destinationToken) {
    setDestinationToken(destinationKey);
    if (!destinationKey && browsing && !stayArea) setMode("chat");
  }

  const adults = Math.max(1, state.members.filter((member) => member.joined).length);
  const datesReady = validRange(state.startDate, state.endDate);
  const destinationName = (state.destinationLabel || destination?.label || "").trim();
  const destinationIata = (state.destinationIata || destination?.code || "").trim();
  const tripPlace =
    state.destinationLat != null && state.destinationLng != null
      ? {
          label: destinationName || "Destination",
          lat: state.destinationLat,
          lng: state.destinationLng,
          iata: destinationIata,
        }
      : destination
        ? { label: destination.label, lat: destination.lat, lng: destination.lng, iata: destination.code }
        : destinationName || destinationIata
          ? { label: destinationName || destinationIata, lat: null, lng: null, iata: destinationIata }
          : null;
  const browsePlace = stayArea ? { ...stayArea, iata: "" } : tripPlace;
  const canBrowse = Boolean(browsing && browsePlace && datesReady);
  const browseKey = canBrowse
    ? `${browsePlace!.lat ?? ""}|${browsePlace!.lng ?? ""}|${encodeURIComponent(browsePlace!.label)}|${state.startDate}|${state.endDate}|${adults}|${destination?.id ?? ""}|${browsePlace!.iata ?? ""}`
    : "";
  if (browseKey !== browseToken) {
    setBrowseToken(browseKey);
    setStayCards([]);
    setLoadedBrowseKey("");
    setStayStatus(browseKey ? "loading" : "idle");
  }
  const roundTrip = state.roundTrip !== false;
  const flightOrigin = chatOrigin || state.originLabel?.trim() || rememberedFlightOrigin();
  const flightDestination = (state.destinationIata || destination?.code || state.destinationLabel || destination?.label || "").trim();
  const flightDatesReady = roundTrip ? datesReady : Boolean(state.startDate);
  const canBrowseFlights = mode === "flights" && Boolean(flightOrigin) && Boolean(flightDestination) && flightDatesReady;
  const flightKey = canBrowseFlights
    ? `${flightOrigin}|${flightDestination}|${state.startDate}|${roundTrip ? state.endDate : ""}|${adults}`
    : "";
  if (flightKey !== flightToken) {
    setFlightToken(flightKey);
    setFlightCards([]);
    setFlightNote("");
    setLoadedFlightKey("");
    setFlightStatus(flightKey ? "loading" : "idle");
  }
  const datesLabel = datesReady
    ? formatRange(state.startDate, state.endDate)
    : "Dates flexible";
  const budgetLabel = budget != null ? `${money(budget)} / person` : "Budget open";
  const title = destination ? `Trip to ${destination.label}` : "New trip";

  let intro = "";
  if (destination && featured) {
    const total = featured.price * nights;
    const over = stayOverBudget(featured.price, nights, budget)
      ? `It's ${money(featured.price)} a night, or ${money(total)} for ${nights} ${nights === 1 ? "night" : "nights"}, over your ${money(budget ?? 0)} per-person target. It's still the strongest match I can confirm for the group.`
      : `It lands at ${money(featured.price)} a night in ${featured.neighborhood}, with a ${featured.rating} rating.`;
    intro = `I found ${featured.name} for ${destination.label}. ${over} It's one of the clearer fits for this party size.`;
  }

  const markers: MapMarker[] = !destination
    ? []
    : stays.map((stay, index) => {
        const offset = PIN_OFFSETS[index % PIN_OFFSETS.length];
        return {
          id: stay.id,
          label: browsing ? money(stay.price) : stay.neighborhood,
          lng: destination.lng + offset.lng,
          lat: destination.lat + offset.lat,
          selected: stay.id === selectedId,
          variant: browsing ? "price" : "place",
        };
      });

  useEffect(() => {
    const viewport = feedRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!browseKey) return;
    const controller = new AbortController();
    const [lat, lng, label, checkIn, checkOut, adultsParam, destinationId, iata] = browseKey.split("|");
    const placeLabel = decodeURIComponent(label);
    const params = new URLSearchParams({
      label: placeLabel,
      checkIn,
      checkOut,
      adults: adultsParam,
    });
    if (lat && lng) {
      params.set("lat", lat);
      params.set("lng", lng);
    } else {
      params.set("place", placeLabel);
      if (iata) params.set("iata", iata);
    }
    if (destinationId) params.set("destinationId", destinationId);
    fetch(`/api/stays/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as { stays?: StayCard[] };
        setStayCards(body.stays ?? []);
        setLoadedBrowseKey(browseKey);
        setStayStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStayStatus("error");
      });
    return () => controller.abort();
  }, [browseKey]);

  useEffect(() => {
    if (!flightKey) return;
    const controller = new AbortController();
    const [origin, flightDestinationParam, departureDate, returnDate, travelers] = flightKey.split("|");
    const params = new URLSearchParams({
      origin,
      destination: flightDestinationParam,
      departureDate,
      travelers,
    });
    if (returnDate) params.set("returnDate", returnDate);
    fetch(`/api/flights/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { flights?: FlightOffer[]; note?: string; error?: { message?: string } };
        if (!response.ok) {
          setFlightCards([]);
          setFlightNote(body.error?.message || "Flights are unavailable right now.");
          setLoadedFlightKey(flightKey);
          setFlightStatus("ready");
          return;
        }
        setFlightCards(body.flights ?? []);
        setFlightNote(body.note ?? "");
        setLoadedFlightKey(flightKey);
        setFlightStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setFlightStatus("error");
      });
    return () => controller.abort();
  }, [flightKey]);

  const browseReady = browseKey !== "" && loadedBrowseKey === browseKey;
  const rankedStays = relevantOffers(
    browseReady ? stayCards : [],
    (card) => stayExceedsBudget(card, nights, budget),
    (card) => card.nightlyAmount ?? Number.POSITIVE_INFINITY,
  );
  const browseCards = rankedStays.items;
  const browseStatus = !browseKey ? "idle" : stayStatus === "error" ? "error" : browseReady ? stayStatus : "loading";
  const stayBudgetNotice =
    browseStatus === "ready" && rankedStays.relaxed
      ? "Nothing fit the budget. Showing the closest prices."
      : null;
  const flightReady = flightKey !== "" && loadedFlightKey === flightKey;
  const rankedFlights = relevantOffers(
    flightReady ? flightCards : [],
    (flight) => flightExceedsBudget(flight, budget),
    (flight) => flight.price,
  );
  const visibleFlights = rankedFlights.items;
  const flightBrowseStatus = !flightKey ? "idle" : flightStatus === "error" ? "error" : flightReady ? flightStatus : "loading";
  const flightBudgetNotice =
    flightBrowseStatus === "ready" && rankedFlights.relaxed
      ? "Nothing fit the budget. Showing the closest fares."
      : null;

  function push(role: Line["role"], text: string) {
    setLines((current) => [...current, { id: `${role}-${Date.now()}-${current.length}`, role, text }]);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    chatAbort.current?.abort();
    const controller = new AbortController();
    chatAbort.current = controller;
    const generation = ++chatGeneration.current;
    const city = chatCityDestination(trimmed, state.destinationId);
    if (city) {
      trip.confirmDestination(city.id);
      trip.commitDraft?.();
    }
    const userLine: Line = { id: `user-${nextLine.current + 1}`, role: "user", text: trimmed };
    const pendingId = `agent-${nextLine.current + 2}`;
    nextLine.current += 2;
    const history = [...lines.filter((line) => !line.pending), userLine];
    setLines([...history, { id: pendingId, role: "agent", text: "Looking that up…", pending: true }]);
    setDraft("");
    const update = (next: Partial<Line>) => {
      if (chatGeneration.current !== generation) return;
      setLines((current) => current.map((line) => (line.id === pendingId ? { ...line, ...next } : line)));
    };
    try {
      const response = await fetch("/api/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history
            .filter((line) => line.text.trim())
            .map((line) => ({ role: line.role === "agent" ? "assistant" : "user", text: line.text })),
          trip: {
            destination: destination?.label ?? state.destinationLabel ?? "",
            origin: flightOrigin,
            startDate: state.startDate,
            endDate: state.endDate,
            budget: state.budget,
            members: state.members.filter((member) => member.joined).map((member) => member.name),
          },
          fromQuestionnaire: fromQuestionnaireRef.current,
          clarifyCount: clarifyCount.current,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        update({ text: body?.error?.message || "I couldn't look that up right now. Try again in a moment.", pending: false });
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        update({ text: "I couldn't look that up right now. Try again in a moment.", pending: false });
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let flights: FlightOffer[] = [];
      let hotels: HotelOffer[] = [];
      let settled = false;
      let asked = false;
      let committed = false;
      const show = (pending: boolean) => {
        update({ text: answer.trim() || "Looking that up…", flights, hotels, pending });
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = parseChatEvent(part);
          if (!event) continue;
          if (event.type === "status") {
            if (!answer.trim()) update({ text: event.text, pending: true, flights, hotels });
          } else if (event.type === "clarify") {
            asked = true;
          } else if (event.type === "stayArea") {
            setStayArea({ label: event.label, lat: event.lat, lng: event.lng });
            setMode("stays");
          } else if (event.type === "text") {
            answer += event.delta;
            show(false);
          } else if (event.type === "cards") {
            flights = event.flights;
            hotels = event.hotels;
            if (event.commit) {
              committed = true;
              const flight = flights[0];
              const hotel = hotels[0];
              if (flight) pickLiveFlight(flight);
              if (hotel) pickChatHotel(hotel);
            }
            const origin = flights[0]?.origin;
            if (origin) {
              setChatOrigin(origin);
              rememberFlightOrigin(origin);
            }
            update({ flights, hotels, pending: !answer.trim() });
          } else if (event.type === "error") {
            settled = true;
            update({
              text: answer.trim() ? `${answer.trim()}\n\n${event.message}` : event.message,
              flights,
              hotels,
              pending: false,
            });
          } else if (event.type === "done") {
            settled = true;
            update({
              text: answer.trim() || offerRecommendation(flights, hotels) || SAFE_LINE,
              flights,
              hotels,
              pending: false,
            });
          }
        }
      }
      if (!settled) {
        update({
          text: answer.trim() || offerRecommendation(flights, hotels) || SAFE_LINE,
          flights,
          hotels,
          pending: false,
        });
      }
      if (committed) clarifyCount.current = 0;
      else if (asked) clarifyCount.current += 1;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setLines((current) =>
          current.flatMap((line) => {
            if (line.id !== pendingId) return [line];
            if (line.pending && !line.flights?.length && !line.hotels?.length) return [];
            return [{ ...line, pending: false }];
          }),
        );
        return;
      }
      update({ text: "I couldn't look that up right now. Try again in a moment.", pending: false });
    }
  }

  useLayoutEffect(() => {
    if (sessionStorage.getItem(QUESTIONNAIRE_KICKOFF_KEY) === "1") {
      fromQuestionnaireRef.current = true;
      setFromQuestionnaire(true);
    }
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(QUESTIONNAIRE_KICKOFF_KEY) !== "1") return;
    const brief = questionnaireBrief(state);
    const timeout = window.setTimeout(() => {
      sessionStorage.removeItem(QUESTIONNAIRE_KICKOFF_KEY);
      void send(brief);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [state, send]);

  function pickLiveStay(stay: StayCard) {
    trip.chooseStay(stay);
    trip.commitDraft?.();
    setSelectedId(stay.id);
    push("agent", `${stay.name} is saved for the group. The highlighted pin is the one to share.`);
  }

  function chooseFixtureStay() {
    if (!destination || !featured) return;
    trip.lockStay(featured.id);
    trip.commitDraft?.();
    setSelectedId(featured.id);
    push("agent", `${featured.name} is saved for the group. The highlighted pin is the one to share.`);
  }

  function pickLiveFlight(flight: FlightOffer) {
    trip.chooseFlight(flight);
    trip.commitDraft?.();
  }

  function pickChatHotel(hotel: HotelOffer) {
    const chosen = chosenStayFromHotel(hotel);
    if (!chosen) return;
    trip.chooseStay(chosen);
    trip.commitDraft?.();
  }

  function noteVoice() {
    if (voiceNoted) return;
    setVoiceNoted(true);
    push("agent", "Voice isn't connected in this preview. Type the question and I'll keep planning.");
  }

  return (
    <AppShell>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_240px] lg:grid-rows-1",
          browsing ? "lg:grid-cols-[minmax(420px,58%)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(380px,46%)_minmax(0,1fr)]",
        )}
      >
        <section className="flex min-h-0 flex-col border-line-soft bg-white lg:border-r">
          <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
            <Button
              variant="outline"
              size="icon"
              nativeButton={false}
              render={<Link href="/trips" />}
              className="size-8 rounded-[9px]"
              aria-label="Back to trips"
            >
              <ChevronLeft />
            </Button>
            {destination ? (
              <span className="relative size-9 shrink-0 overflow-hidden rounded-[9px]">
                <Image src={destination.photos[0]} alt="" fill sizes="36px" className="object-cover" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[14.5px] font-bold">{title}</h1>
              <p className="truncate text-[12px] text-muted">
                {destination ? `Trip to ${destination.label}, ${destination.country}` : "Pick a city to start"}
              </p>
            </div>
            {mode === "chat" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode("flights")}
                  className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px] font-semibold"
                >
                  Browse flights
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode("stays")}
                  className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px] font-semibold"
                >
                  Browse stays
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("chat")}
                className="h-8 shrink-0 rounded-[9px] px-3 text-[12.5px] font-semibold"
              >
                Back to chat
              </Button>
            )}
          </div>
          {browsing ? null : (
          <div className="flex gap-2 overflow-x-auto border-b border-line-soft px-5 py-3">
            <Badge variant="secondary" className="h-7 gap-1.5 rounded-full bg-bg-muted px-2.5 font-semibold text-muted">
              <Calendar className="size-3" />
              {datesLabel}
            </Badge>
            <Badge variant="secondary" className="h-7 gap-1.5 rounded-full bg-bg-muted px-2.5 font-semibold text-muted">
              <Users className="size-3" />
              {state.members.length} travelers
            </Badge>
            <Badge variant="secondary" className="h-7 rounded-full bg-bg-muted px-2.5 font-semibold text-muted">
              {budgetLabel}
            </Badge>
          </div>
          )}

          {mode === "flights" ? (
            <FlightBrowseList
              flights={visibleFlights}
              status={flightBrowseStatus}
              hasOrigin={Boolean(flightOrigin)}
              hasDestination={Boolean(flightDestination)}
              datesReady={flightDatesReady}
              notice={flightBudgetNotice ?? (flightBrowseStatus === "ready" ? flightNote : null)}
              selectedId={state.lockedFlightId}
              onChoose={pickLiveFlight}
            />
          ) : browsing ? (
            <StayBrowseGrid
              cards={browseCards}
              status={browseStatus}
              datesReady={datesReady}
              hasPlace={Boolean(browsePlace)}
              notice={stayBudgetNotice}
              selectedId={selectedId}
              lockedStayId={state.lockedStayId}
              listingHref={(id) => {
                const params = new URLSearchParams({
                  checkIn: state.startDate,
                  checkOut: state.endDate,
                  adults: String(adults),
                });
                return `/stays/${encodeURIComponent(id)}?${params}`;
              }}
              onChoose={pickLiveStay}
            />
          ) : (
          <>
          <ScrollArea ref={feedRef} className="min-h-0 flex-1">
            <div className="space-y-4 px-5 py-4">
              {featured && destination && !fromQuestionnaire ? (
                <>
                  <div className="flex gap-2.5">
                    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                      <Sparkles className="size-3.5" />
                    </span>
                    <p className="pt-0.5 text-[13.5px] leading-relaxed text-ink">{intro}</p>
                  </div>
                  <article className="overflow-hidden rounded-[14px] border border-line shadow-[var(--shadow)]">
                    <div className="grid h-[118px] grid-cols-2 gap-0.5">
                      {[featured.image, destination.photos[1]].map((src, index) => (
                        <div key={`${src}-${index}`} className="relative">
                          <Image src={src} alt="" fill sizes="240px" className="object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="p-4">
                      <Badge className="mb-2.5 border-transparent bg-[#e7f3ec] text-success">
                        <Check className="size-3" />
                        Good fit for {state.members.length} travelers
                      </Badge>
                      <h2 className="text-[15.5px] font-bold">{featured.name}</h2>
                      <p className="mt-1 mb-3 text-[13px] leading-relaxed text-muted">
                        {featured.neighborhood}, confirmed in the draft for your dates, {featured.rating} from {featured.reviews}{" "}
                        reviews.
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[15px] font-semibold tabular-nums">
                          {money(featured.price)} <span className="text-[12.5px] font-medium text-muted">/ night</span>
                        </p>
                        <Button
                          type="button"
                          onClick={chooseFixtureStay}
                          disabled={state.lockedStayId === featured.id}
                          className="h-10 rounded-[9px] bg-accent px-3.5 text-[12.5px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:translate-y-px"
                        >
                          {state.lockedStayId === featured.id ? "Room saved" : "Choose room"}
                        </Button>
                      </div>
                      {state.lockedStayId === featured.id ? (
                        <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
                          <Heart className="size-3.5 fill-accent" />
                          Saved for the group
                        </p>
                      ) : null}
                    </div>
                  </article>
                  {rest.length > 0 ? (
                    <section className="overflow-hidden rounded-[14px] border border-line">
                      <h2 className="bg-bg-muted px-4 py-3 text-[12.5px] font-bold text-muted">Not a great fit</h2>
                      <ul>
                        {rest.map((stay) => {
                          const copy = unfitCopy(stay, budget, nights);
                          const selected = stay.id === selectedId;
                          return (
                            <li key={stay.id} className="border-t border-line">
                              <button
                                type="button"
                                onClick={() => setSelectedId(stay.id)}
                                className={cn(
                                  "flex w-full gap-3.5 px-4 py-3 text-left",
                                  selected && "bg-tip",
                                )}
                              >
                                <span className="w-[140px] shrink-0 text-[13px] font-bold">{stay.name}</span>
                                <span className="text-[12.5px] leading-relaxed text-muted">
                                  <Badge className="mb-1 border-transparent bg-[#fbeee0] text-warning">{copy.tag}</Badge>
                                  <span className="block">{copy.reason}</span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : (
                <p className="text-[14px] text-muted">
                  No stays yet.{" "}
                  <Link href="/onboarding" className="font-semibold text-accent">
                    Start the questionnaire
                  </Link>{" "}
                  and the map will settle on a city.
                </p>
              )}
              {lines.map((line) =>
                line.role === "user" ? (
                  <p
                    key={line.id}
                    className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-3.5 py-2 text-[13.5px] leading-relaxed text-white"
                  >
                    {line.text}
                  </p>
                ) : (
                  <div key={line.id} className="flex gap-2.5">
                    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                      <Sparkles className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className={cn("pt-0.5 text-[13.5px] leading-relaxed", line.pending && "text-muted")}>{line.text}</p>
                      {line.flights && line.flights.length > 0 ? (
                        <FlightResultCards flights={line.flights} selectedId={state.lockedFlightId} onChoose={pickLiveFlight} />
                      ) : null}
                      {line.hotels && line.hotels.length > 0 ? (
                        <HotelResultCards hotels={line.hotels} selectedId={state.lockedStayId} onChoose={pickChatHotel} />
                      ) : null}
                    </div>
                  </div>
                ),
              )}
            </div>
          </ScrollArea>

          <form
            className="border-t border-line-soft px-5 pt-3.5 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              return send(draft);
            }}
          >
            <div className="mb-2.5 flex gap-2 overflow-x-auto">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="shrink-0 rounded-full bg-bg-muted px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-line py-1.5 pr-1.5 pl-4">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask your trip agent…"
                aria-label="Message the trip agent"
                className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
              />
              <Button
                type="button"
                size="icon"
                aria-pressed={voiceNoted}
                aria-label="Voice note"
                onClick={noteVoice}
                className={cn("size-9 rounded-[10px]", voiceNoted ? "bg-accent text-white" : "bg-bg-muted text-ink")}
              >
                <Mic />
              </Button>
              <Button type="submit" size="icon" className="size-9 rounded-[10px] bg-accent text-white transition duration-200 hover:bg-accent-hover active:translate-y-px" aria-label="Send">
                <Send />
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted">
              The agent can make mistakes — check availability before booking.
            </p>
          </form>
          </>
          )}
        </section>
        <div className="relative h-full min-h-0">
          <TripMap
            focus={destination}
            pinned={Boolean(destination)}
            markers={markers}
            onSelectMarker={setSelectedId}
          />
        </div>
      </div>
    </AppShell>
  );
}
