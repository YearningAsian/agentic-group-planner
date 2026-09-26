"use client";

/**
 * `/studio` split view inside `AppShell`: chat and stay cards on the left, `TripMap` on the right.
 * Opened from `EntryChoice` Chat and from `OnboardingFlow.finish()`.
 * A null `destinationId` stays empty; exact city chat messages call `confirmDestination` before stay cards appear.
 * City detect is `chatCityDestination` in `fixtures.ts`. Nightly-vs-budget ranking is `splitStays` here; `/plan` uses nights in `plan-picker.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Check, ChevronLeft, Heart, Mic, Send, Sparkles, Users } from "lucide-react";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { TripMap } from "@/features/trip-draft/components/trip-map";
import type { MapMarker } from "@/features/trip-draft/components/fallback-map";
import { chatCityDestination, destinationById, findStay, staysFor, type StayOption } from "@/features/trip-draft/fixtures";
import { formatRange, money, nightsBetween, stayOverBudget, validRange } from "@/features/trip-draft/format";
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

type Line = { id: string; role: "agent" | "user"; text: string };

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

function agentReply(text: string, place: string, stayName: string) {
  const q = text.toLowerCase();
  if (q.includes("pool")) {
    return `None of the stays pinned in ${place} list a pool. ${stayName} is still the one I'd share with the group.`;
  }
  if (q.includes("center") || q.includes("closer") || q.includes("downtown")) {
    return `The pins nearer the middle of ${place} are already on the map. ${stayName} remains the clearer fit.`;
  }
  if (q.includes("quiet")) {
    return `${stayName} is the quieter of this set. The others sit on busier streets.`;
  }
  if (q.includes("budget") || q.includes("raise") || q.includes("$")) {
    return `I'll weigh that against the prices on the cards. The map stays on ${place}.`;
  }
  return `Noted. I'll keep planning ${place} around that, using the stays already on the map.`;
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
  const [selectedId, setSelectedId] = useState(featured?.id ?? "");
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [voiceNoted, setVoiceNoted] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const datesLabel = validRange(state.startDate, state.endDate)
    ? formatRange(state.startDate, state.endDate)
    : "Dates flexible";
  const budgetLabel = budget != null ? `${money(budget)} / person` : "Budget open";
  const title = destination ? `Trip to ${destination.label}` : "New trip";

  const intro = useMemo(() => {
    if (!destination || !featured) return "";
    const total = featured.price * nights;
    const over = stayOverBudget(featured.price, nights, budget)
      ? `It's ${money(featured.price)} a night, or ${money(total)} for ${nights} ${nights === 1 ? "night" : "nights"}, over your ${money(budget ?? 0)} per-person target. It's still the strongest match I can confirm for the group.`
      : `It lands at ${money(featured.price)} a night in ${featured.neighborhood}, with a ${featured.rating} rating.`;
    return `I found ${featured.name} for ${destination.label}. ${over} It's one of the clearer fits for this party size.`;
  }, [budget, destination, featured, nights]);

  const markers: MapMarker[] = useMemo(() => {
    if (!destination) return [];
    return stays.map((stay, index) => {
      const offset = PIN_OFFSETS[index % PIN_OFFSETS.length];
      return {
        id: stay.id,
        label: stay.neighborhood,
        lng: destination.lng + offset.lng,
        lat: destination.lat + offset.lat,
        selected: stay.id === selectedId,
      };
    });
  }, [destination, selectedId, stays]);

  useEffect(() => {
    const viewport = feedRef.current?.querySelector("[data-slot=scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [lines]);

  useEffect(() => {
    setSelectedId(featured?.id ?? "");
  }, [featured?.id]);

  function push(role: Line["role"], text: string) {
    setLines((current) => [...current, { id: `${role}-${Date.now()}-${current.length}`, role, text }]);
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    push("user", trimmed);
    const city = chatCityDestination(trimmed, state.destinationId);
    if (city) {
      trip.confirmDestination(city.id);
      push("agent", `Got it — flying the map to ${city.label}, ${city.country}. I'll keep planning around the stays already pinned.`);
    } else if (!destination || !featured) {
      push("agent", "Tell me a city name like Lisbon, Kyoto, or Mexico City and I'll move the map there.");
    } else {
      push("agent", agentReply(trimmed, destination.label, featured.name));
    }
    setDraft("");
  }

  function chooseStay() {
    if (!destination || !featured) return;
    trip.lockStay(featured.id);
    setSelectedId(featured.id);
    push("agent", `${featured.name} is saved for the group. The highlighted pin is the one to share.`);
  }

  function noteVoice() {
    if (voiceNoted) return;
    setVoiceNoted(true);
    push("agent", "Voice isn't connected in this preview. Type the question and I'll keep planning.");
  }

  return (
    <AppShell>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_240px] lg:grid-cols-[minmax(380px,46%)_minmax(0,1fr)] lg:grid-rows-1">
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
            <div className="min-w-0">
              <h1 className="truncate text-[14.5px] font-bold">{title}</h1>
              <p className="truncate text-[12px] text-muted">
                {destination ? `Trip to ${destination.label}, ${destination.country}` : "Pick a city to start"}
              </p>
            </div>
          </div>
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

          <ScrollArea ref={feedRef} className="min-h-0 flex-1">
            <div className="space-y-4 px-5 py-4">
              {featured && destination ? (
                <>
                  <div className="flex gap-2.5">
                    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                      <Sparkles className="size-3.5" />
                    </span>
                    <p className="pt-0.5 text-[13.5px] leading-relaxed text-ink">{intro}</p>
                  </div>
                  <article className="overflow-hidden rounded-[14px] border border-line shadow-[var(--shadow)]">
                    <div className="grid h-[118px] grid-cols-2 gap-0.5">
                      {[featured.image, destination.photos[1]].map((src) => (
                        <div key={src} className="relative">
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
                        <p className="text-[15px] font-extrabold">
                          {money(featured.price)} <span className="text-[12.5px] font-medium text-muted">/ night</span>
                        </p>
                        <Button
                          type="button"
                          onClick={chooseStay}
                          disabled={state.lockedStayId === featured.id}
                          className="h-10 rounded-[9px] bg-accent px-3.5 text-[12.5px] font-bold text-white hover:bg-[#e00b41]"
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
                    <p className="pt-0.5 text-[13.5px] leading-relaxed">{line.text}</p>
                  </div>
                ),
              )}
            </div>
          </ScrollArea>

          <form
            className="border-t border-line-soft px-5 pt-3.5 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
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
              <Button type="submit" size="icon" className="size-9 rounded-[10px] bg-accent text-white hover:bg-[#e00b41]" aria-label="Send">
                <Send />
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted">
              The agent can make mistakes — check availability before booking.
            </p>
          </form>
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
