"use client";

/**
 * Current-trip dashboard (port of `Trip summary graph — Flights → Hotel → Invite.html`).
 * Reads the session draft from `useTrip` — destination, dates, locked flight/stay, and members —
 * and writes picks back through the same actions, so Picks and Progress stay in sync.
 * Comments and the "someone just suggested a fare" beat are local to this screen.
 * TODO: replace the timed suggestion and simulated join with live trip-view events.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  destinationById,
  findFlight,
  findStay,
  flightsFor,
  staysFor,
  type FlightOption,
  type StayOption,
} from "@/features/trip-draft/fixtures";
import { formatRange, initials, money } from "@/features/trip-draft/format";
import { useTrip, type Member, type TripState } from "@/features/trip-draft/trip-context";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { cn } from "@/lib/utils";

type Marker = "done" | "active" | "pending";
type Thread = "flight" | "stay";

type Suggestion = {
  id: string;
  kind: Thread;
  optionId: string;
  title: string;
  meta: string;
  priceLabel: string;
  image: string;
};

type Comment = {
  id: string;
  memberIndex: number;
  name: string;
  text: string;
  /** Epoch ms. Null keeps the fixed `timeLabel` (seeded lines that predate this visit). */
  at: number | null;
  timeLabel?: string;
  suggestion?: Suggestion;
};

const TONES = [
  { bg: "#EFD9CE", color: "#8A4B31" },
  { bg: "#DCEBE3", color: "#2F7D5B" },
  { bg: "#EFE3D9", color: "#8A6A31" },
  { bg: "#E6DCF0", color: "#6B3FA0" },
] as const;

const CARD_SHADOW = "0 1px 2px rgba(34,31,26,.04), 0 8px 24px -12px rgba(34,31,26,.10)";

export function TripSummary() {
  const { state } = useTrip();
  const destination = destinationById(state.destinationId);
  if (!destination) return <EmptySummary />;
  return <SummaryBody key={destination.id} />;
}

function EmptySummary() {
  return (
    <AppShell>
      <div className="min-h-full bg-[#FBF8F3] text-[#221F1A]">
      <div className="mx-auto max-w-[760px] px-5 py-8">
        <section className="rounded-[20px] border border-[#EAE3D4] bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
          <h2 className="text-[18px] font-bold tracking-tight">No trip selected</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#756E60]">
            Answer the questions and this page fills in with flights, a stay, and who has joined.
          </p>
          <Link
            href="/onboarding"
            className="mt-5 inline-flex h-11 items-center rounded-[9px] bg-[#221F1A] px-4 text-[13px] font-bold text-white"
          >
            Start the questionnaire
          </Link>
        </section>
      </div>
      </div>
    </AppShell>
  );
}

function SummaryBody() {
  const trip = useTrip();
  const { state } = trip;
  const destination = destinationById(state.destinationId);
  const flights = flightsFor(state.destinationId);
  const stays = staysFor(state.destinationId);
  const lockedFlight = findFlight(state.destinationId, state.lockedFlightId);
  const lockedStay = findStay(state.destinationId, state.lockedStayId);
  const flight = lockedFlight ?? cheapest(flights);
  const stay = lockedStay ?? topRated(stays);

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const link = origin ? `${origin}/itinerary` : "https://grouptrip.app/join/demo";

  const [openedAt] = useState(() => Date.now());
  const [now, setNow] = useState(openedAt);
  const [activity, setActivity] = useState<{ detail: string; at: number } | null>(null);
  const [flightsOpen, setFlightsOpen] = useState(false);
  const [flightTalkOpen, setFlightTalkOpen] = useState(false);
  const [stayTalkOpen, setStayTalkOpen] = useState(false);
  const [posted, setPosted] = useState<Array<Comment & { thread: Thread }>>([]);
  const [drafts, setDrafts] = useState<Record<Thread, string>>({ flight: "", stay: "" });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [live, setLive] = useState<Comment | null>(null);
  const [copied, setCopied] = useState(false);

  const talkTouched = useRef(false);
  const joinSeen = useRef<string | null | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  // A group member drops a real alternate fare into the flight thread shortly after open.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const built = buildLiveFlightComment(stateRef.current);
      if (!built) return;
      setLive(built.comment);
      setActivity({ detail: built.activity, at: built.comment.at ?? Date.now() });
      setNow(Date.now());
      if (!talkTouched.current) setFlightTalkOpen(true);
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, []);

  // Same join beat as Progress: once both picks are locked, the next pending person joins.
  const inviteReached = Boolean(lockedFlight && lockedStay);
  useEffect(() => {
    if (!inviteReached || state.didSimulateJoin) return;
    const timeout = window.setTimeout(() => trip.markFirstPendingJoined(), 1600);
    return () => window.clearTimeout(timeout);
  }, [inviteReached, state.didSimulateJoin, trip]);

  useEffect(() => {
    if (joinSeen.current === undefined) {
      joinSeen.current = state.justJoinedName;
      return;
    }
    if (state.justJoinedName && state.justJoinedName !== joinSeen.current) {
      joinSeen.current = state.justJoinedName;
      const at = Date.now();
      setActivity({ detail: `${state.justJoinedName} joined the trip`, at });
      setNow(at);
    }
  }, [state.justJoinedName]);

  // Seed lines stay put for this visit. Later picks update the cards, not the earlier comments.
  const [flightSeed] = useState(() => {
    const options = flightsFor(state.destinationId);
    const leading = findFlight(state.destinationId, state.lockedFlightId) ?? cheapest(options);
    return leading ? seedFlightComment(state.members, leading) : null;
  });
  const [staySeed] = useState(() => {
    const options = staysFor(state.destinationId);
    const leading = findStay(state.destinationId, state.lockedStayId) ?? topRated(options);
    return leading ? seedStayComment(state.members, leading, options) : null;
  });
  const flightComments = [flightSeed, live, ...posted.filter((item) => item.thread === "flight")].filter(
    (item): item is Comment => Boolean(item),
  );
  const stayComments = [staySeed, ...posted.filter((item) => item.thread === "stay")].filter(
    (item): item is Comment => Boolean(item),
  );

  if (!destination) return null;

  const detail =
    activity?.detail ??
    (state.justJoinedName
      ? `${state.justJoinedName} joined the trip`
      : lockedStay
        ? `${lockedStay.name} is locked in`
        : lockedFlight
          ? `${lockedFlight.airline} is the leading flight`
          : `${destination.label} is the current trip`);
  const stamp = activity?.at ?? openedAt;

  const flightMarker: Marker = lockedFlight ? "done" : flights.length > 0 ? "active" : "pending";
  const stayMarker: Marker = lockedStay ? "done" : lockedFlight ? "active" : "pending";
  const inviteMarker: Marker = !inviteReached ? "pending" : state.inviteShared ? "done" : "active";
  const joined = state.members.filter((member) => member.joined);
  const voters = joined.slice(0, 3);

  function note(next: string) {
    const at = Date.now();
    setActivity({ detail: next, at });
    setNow(at);
  }

  function post(thread: Thread) {
    const text = drafts[thread].trim();
    if (!text) return;
    const at = Date.now();
    setPosted((current) => [
      ...current,
      {
        id: `post-${at}`,
        thread,
        memberIndex: 0,
        name: memberLabel(state.members[0], 0),
        text,
        at,
      },
    ]);
    setDrafts((current) => ({ ...current, [thread]: "" }));
    note(`${memberLabel(state.members[0], 0)} commented on ${thread === "flight" ? "flights" : "the stay"}`);
  }

  function lockPickedFlight(id: string, airline: string) {
    if (id === state.lockedFlightId) return;
    trip.lockFlight(id);
    note(`${memberLabel(state.members[0], 0)} picked ${airline}`);
  }

  function lockPickedStay(id: string, stayName: string) {
    if (id === state.lockedStayId) return;
    trip.lockStay(id);
    note(`${memberLabel(state.members[0], 0)} picked ${stayName}`);
  }

  function acceptSuggestion(suggestion: Suggestion) {
    if (suggestion.kind === "flight") {
      const picked = findFlight(state.destinationId, suggestion.optionId);
      lockPickedFlight(suggestion.optionId, picked?.airline ?? "that flight");
    } else {
      const picked = findStay(state.destinationId, suggestion.optionId);
      lockPickedStay(suggestion.optionId, picked?.name ?? "that stay");
    }
  }

  async function copyLink() {
    const write = navigator.clipboard?.writeText(link).catch(() => undefined);
    trip.markInviteShared();
    setCopied(true);
    note("Invite link copied");
    window.setTimeout(() => setCopied(false), 1600);
    await write;
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join the ${destination?.label ?? "group"} trip`, url: link });
        trip.markInviteShared();
        note("Invite link shared");
        return;
      } catch {
        // A cancelled share falls through to copy.
      }
    }
    await copyLink();
  }

  const others = flights.filter((item) => item.id !== flight?.id);
  const fan = [others[1], others[0], flight].filter((item): item is FlightOption => Boolean(item));
  const alternates = stays.filter((item) => item.id !== stay?.id);

  return (
    <AppShell>
      <div className="min-h-full bg-[#FBF8F3] text-[#221F1A]">
      <div className="mx-auto max-w-[760px] px-5 pt-6 pb-20">
        <div
          className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-[#EAE3D4] bg-white px-[18px] py-3.5 sm:flex-nowrap"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <div className="min-w-0 w-full sm:w-auto sm:flex-1">
            <h2 className="truncate text-[16px] font-bold">
              {destination.label} · {formatRange(state.startDate, state.endDate)}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-[#A69E8D]">Trip summary — updates as the group chats and answers questions</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#E7F3EC] px-2.5 py-1 text-[11.5px] font-bold text-[#2F7D5B]">
            <span className="trip-live-dot h-1.5 w-1.5 rounded-full bg-[#2F7D5B]" />
            Live
          </span>
          <AvatarStack members={state.members} />
          <button
            type="button"
            onClick={() => void shareLink()}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[9px] bg-[#221F1A] px-3 text-[12.5px] font-bold text-white hover:bg-black"
          >
            <PenIcon className="h-3.5 w-3.5" />
            Share
          </button>
        </div>

        <p className="flex items-center gap-2 px-1 py-3.5 pb-5 text-[12px] text-[#A69E8D]" aria-live="polite">
          <ClockIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span>
            Updated {ago(stamp, now)} — <b className="font-bold text-[#756E60]">{detail}</b>
          </span>
        </p>

        <div className="relative">
          <div
            className="absolute top-3.5 bottom-3.5 left-[27px] w-0.5"
            style={{ background: "repeating-linear-gradient(to bottom, #DCD3BE 0 6px, transparent 6px 12px)" }}
            aria-hidden
          />
          <ol>
            <SummaryNode
              marker={flightMarker}
              icon={<PlaneIcon className="h-[22px] w-[22px]" />}
              title="Flights"
              status={
                lockedFlight
                  ? "Locked in"
                  : flights.length > 0
                    ? `${flights.length} options · group deciding`
                    : "No fares yet"
              }
              current={flightMarker === "active"}
            >
              {flight ? (
                <section className="overflow-hidden rounded-[20px] border border-[#EAE3D4] bg-white" style={{ boxShadow: CARD_SHADOW }}>
                  <button
                    type="button"
                    aria-expanded={flightsOpen}
                    onClick={() => setFlightsOpen((open) => !open)}
                    className="w-full px-5 pt-5 pb-3.5 text-left"
                  >
                    <div className="relative mb-2.5 h-[78px]">
                      {fan.map((item, index) => {
                        const depth = fan.length - 1 - index;
                        const front = depth === 0;
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "absolute top-0 left-0 flex h-14 items-center rounded-xl border px-3.5 text-[12.5px] font-semibold",
                              front
                                ? "right-[14%] z-30 border-[#DCD3BE] bg-white text-[#221F1A]"
                                : "border-[#DCD3BE] bg-[#F4EFE6] text-[#756E60]",
                              depth === 1 && "right-[8%] z-20 translate-y-3 -rotate-[1.2deg] scale-[0.98]",
                              depth === 2 && "right-[2%] z-10 translate-y-[22px] rotate-[1.4deg] scale-[0.96]",
                            )}
                            style={front ? { boxShadow: CARD_SHADOW } : undefined}
                          >
                            <span className="mr-2.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#FDE9EE] text-[#F0416A]">
                              <PlaneIcon className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate">
                              {item.airline} · {money(item.price)}
                              {front && item.stops === "Nonstop" ? ", nonstop" : ""}
                            </span>
                            {front ? (
                              <span className="ml-auto shrink-0 rounded-full bg-[#E7F3EC] px-2 py-0.5 text-[10.5px] font-extrabold text-[#2F7D5B]">
                                {lockedFlight ? "Locked" : "Leading"}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <span className="flex items-center justify-between text-[12px] text-[#A69E8D]">
                      <span>
                        {flights.length} shortlisted, {joined.length} {joined.length === 1 ? "vote" : "votes"} cast
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {flightsOpen ? "Hide" : "Show all"}
                        <ChevronIcon className={cn("h-3.5 w-3.5 transition-transform", flightsOpen && "rotate-180")} />
                      </span>
                    </span>
                  </button>

                  {flightsOpen ? (
                    <ul className="px-5 pb-[18px]">
                      {[flight, ...[...others].sort((a, b) => a.price - b.price)].map((item) => {
                        const picked = item.id === state.lockedFlightId;
                        const leading = item.id === flight.id;
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "mb-2.5 flex items-center gap-3 rounded-xl border px-3 py-3",
                              leading ? "border-[#CFE7DA] bg-[#E7F3EC]" : "border-[#EAE3D4] bg-white",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border text-[#F0416A]",
                                leading ? "border-[#CFE7DA] bg-white" : "border-[#EAE3D4] bg-white",
                              )}
                            >
                              <PlaneIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-bold">
                                {item.airline}
                                {item.stops === "Nonstop" ? " · nonstop" : ""}
                              </span>
                              <span className="mt-px block truncate text-[11.5px] text-[#756E60]">
                                {item.from} → {item.to} · {item.duration}
                                {item.stops !== "Nonstop" ? ` · ${item.stops}` : ""}
                              </span>
                            </span>
                            {leading ? (
                              <span className="flex shrink-0">
                                {voters.map((member, index) => (
                                  <Avatar key={member.id} name={memberLabel(member, index)} index={index} size="sm" overlap={index > 0} />
                                ))}
                              </span>
                            ) : null}
                            <span className="shrink-0 text-[14px] font-extrabold">{money(item.price)}</span>
                            <button
                              type="button"
                              aria-pressed={picked}
                              onClick={() => lockPickedFlight(item.id, item.airline)}
                              className={cn(
                                "h-11 shrink-0 rounded-lg px-3 text-[11.5px] font-bold",
                                picked ? "bg-[#2F7D5B] text-white" : "border border-[#DCD3BE] bg-white text-[#221F1A]",
                              )}
                            >
                              {picked ? "Picked" : "Pick this"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  <Discuss
                    count={flightComments.length}
                    open={flightTalkOpen}
                    onToggle={() => {
                      talkTouched.current = true;
                      setFlightTalkOpen((open) => !open);
                    }}
                  >
                    <CommentList
                      comments={flightComments}
                      now={now}
                      dismissed={dismissed}
                      lockedFlightId={state.lockedFlightId}
                      lockedStayId={state.lockedStayId}
                      onAccept={acceptSuggestion}
                      onDismiss={(id) => setDismissed((current) => [...current, id])}
                    />
                    <Composer
                      value={drafts.flight}
                      placeholder="Comment, or paste a flight link to suggest it…"
                      onChange={(value) => setDrafts((current) => ({ ...current, flight: value }))}
                      onSubmit={() => post("flight")}
                    />
                  </Discuss>
                </section>
              ) : (
                <p className="text-[14px] text-[#756E60]">Fares show up after a destination is confirmed.</p>
              )}
            </SummaryNode>

            <SummaryNode
              marker={stayMarker}
              icon={<HouseIcon className="h-[22px] w-[22px]" />}
              title="Hotel / Airbnb"
              status={
                lockedStay ? "Locked in" : stay ? `1 leading · ${alternates.length} ${alternates.length === 1 ? "alternate" : "alternates"}` : "Waiting on a stay"
              }
              current={stayMarker === "active"}
            >
              {stay ? (
                <section className="overflow-hidden rounded-[20px] border border-[#EAE3D4] bg-white" style={{ boxShadow: CARD_SHADOW }}>
                  <div className="px-5 pt-[18px]">
                    <div className="mb-3.5 flex h-[110px] gap-0.5 overflow-hidden rounded-xl">
                      {[stay.image, destination.photos.find((photo) => photo !== stay.image) ?? destination.photos[1]].map((src) => (
                        <div key={src} className="relative min-w-0 flex-1">
                          <Image src={src} alt="" fill sizes="240px" className="object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="mb-1.5 flex items-start justify-between gap-2.5">
                      <h3 className="text-[15px] font-bold">{stay.name}</h3>
                      <span className="shrink-0 rounded-full bg-[#E7F3EC] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[#2F7D5B]">
                        {lockedStay ? "Locked in" : "Leading pick"}
                      </span>
                    </div>
                    <p className="mb-3.5 text-[12.5px] text-[#756E60]">
                      {stay.neighborhood} · {state.members.length} guests · {formatRange(state.startDate, state.endDate)}
                    </p>
                    <div className="flex items-center justify-between pb-4">
                      <p className="text-[15px] font-extrabold">
                        {money(stay.price)} <span className="text-[12px] font-medium text-[#A69E8D]">/ night</span>
                      </p>
                      <span className="flex">
                        {voters.map((member, index) => (
                          <Avatar key={member.id} name={memberLabel(member, index)} index={index} size="sm" overlap={index > 0} />
                        ))}
                      </span>
                    </div>
                    {state.lockedStayId !== stay.id ? (
                      <button
                        type="button"
                        onClick={() => lockPickedStay(stay.id, stay.name)}
                        className="mb-4 h-11 rounded-lg bg-[#221F1A] px-3 text-[12px] font-bold text-white"
                      >
                        Lock this stay
                      </button>
                    ) : null}
                  </div>
                  {alternates.length > 0 ? (
                    <div className="px-5 pb-4 text-[11.5px] text-[#A69E8D]">
                      Also considering{" "}
                      {alternates.map((item, index) => (
                        <span key={item.id}>
                          {index > 0 ? (index === alternates.length - 1 ? " and " : ", ") : null}
                          <button type="button" onClick={() => lockPickedStay(item.id, item.name)} className="font-bold text-[#756E60] underline">
                            {item.name} ({money(item.price)}/night)
                          </button>
                        </span>
                      ))}
                      .
                    </div>
                  ) : null}
                  <Discuss
                    count={stayComments.length}
                    open={stayTalkOpen}
                    onToggle={() => setStayTalkOpen((open) => !open)}
                  >
                    <CommentList
                      comments={stayComments}
                      now={now}
                      dismissed={dismissed}
                      lockedFlightId={state.lockedFlightId}
                      lockedStayId={state.lockedStayId}
                      onAccept={acceptSuggestion}
                      onDismiss={(id) => setDismissed((current) => [...current, id])}
                    />
                    <Composer
                      value={drafts.stay}
                      placeholder="Comment, or paste a listing link to suggest it…"
                      onChange={(value) => setDrafts((current) => ({ ...current, stay: value }))}
                      onSubmit={() => post("stay")}
                    />
                  </Discuss>
                </section>
              ) : (
                <p className="text-[14px] text-[#756E60]">Stays show up after a destination is confirmed.</p>
              )}
            </SummaryNode>

            <SummaryNode
              marker={inviteMarker}
              icon={<PenIcon className="h-[22px] w-[22px]" />}
              title="Invite & share"
              status={`${joined.length} of ${state.members.length} joined`}
              current={inviteMarker === "active"}
              last
            >
              <section className="rounded-[20px] border border-[#EAE3D4] bg-white" style={{ boxShadow: CARD_SHADOW }}>
                <div className="px-5 py-[18px]">
                  <div className="mb-3.5 flex items-center gap-2.5 rounded-xl border border-dashed border-[#DCD3BE] bg-[#F4EFE6] py-2.5 pr-2.5 pl-3.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[#756E60]">{link}</span>
                    <button
                      type="button"
                      onClick={() => void copyLink()}
                      className="h-11 shrink-0 rounded-lg bg-[#221F1A] px-3 text-[11.5px] font-bold text-white hover:bg-black"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {state.members.map((member, index) => {
                      const name = memberLabel(member, index);
                      const badge = index === 0 ? "Organizer" : member.joined ? "Joined" : "Invited";
                      const on = index === 0 || member.joined;
                      return (
                        <li key={member.id} className="flex items-center gap-2.5 text-[13px]">
                          <Avatar name={name} index={index} />
                          <span className="font-semibold">{name}</span>
                          <span
                            className={cn(
                              "ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold",
                              on ? "bg-[#E7F3EC] text-[#2F7D5B]" : "bg-[#FBEEE0] text-[#A85B1C]",
                            )}
                          >
                            {badge}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="sr-only" aria-live="polite">
                    {copied ? "Invite link copied." : ""}
                    {state.justJoinedName ? `${state.justJoinedName} joined the trip.` : ""}
                  </p>
                  {state.justJoinedName ? (
                    <p className="mt-3 text-[13px] font-semibold text-[#2F7D5B]">{state.justJoinedName} just joined.</p>
                  ) : null}
                </div>
              </section>
            </SummaryNode>
          </ol>
        </div>
      </div>
      </div>
    </AppShell>
  );
}

function SummaryNode({
  marker,
  icon,
  title,
  status,
  current,
  last,
  children,
}: {
  marker: Marker;
  icon: ReactNode;
  title: string;
  status: string;
  current: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative z-[1] flex gap-[18px]" aria-current={current ? "step" : undefined}>
      <div className="w-14 shrink-0 pt-0.5">
        <div
          className={cn(
            "relative z-[1] flex h-14 w-14 items-center justify-center rounded-2xl border bg-white",
            marker === "done" && "border-[#CFE7DA] bg-[#E7F3EC] text-[#2F7D5B]",
            marker === "active" && "border-[#F8C9D5] bg-[#FDE9EE] text-[#F0416A]",
            marker === "pending" && "border-[#EAE3D4] text-[#A69E8D]",
          )}
          style={{ boxShadow: CARD_SHADOW }}
        >
          {icon}
        </div>
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1.5" : "pb-8")}>
        <div className="mb-2.5 flex items-center gap-2.5 pt-3">
          <h2 className="text-[15.5px] font-extrabold tracking-tight">{title}</h2>
          <span className="ml-auto text-[12px] font-semibold text-[#A69E8D]">{status}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

function Discuss({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 border-t border-[#EAE3D4] bg-[#F4EFE6] px-5 py-3 text-[12.5px] font-bold text-[#756E60]"
      >
        <ChatIcon className="h-3.5 w-3.5" />
        {count} {count === 1 ? "comment" : "comments"}
        <ChevronIcon className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="px-5 py-4">{children}</div> : null}
    </div>
  );
}

function CommentList({
  comments,
  now,
  dismissed,
  lockedFlightId,
  lockedStayId,
  onAccept,
  onDismiss,
}: {
  comments: Comment[];
  now: number;
  dismissed: string[];
  lockedFlightId: string | null;
  lockedStayId: string | null;
  onAccept: (suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
}) {
  if (comments.length === 0) {
    return <p className="mb-3 text-[12.5px] text-[#A69E8D]">No comments yet. The group thread shows up here.</p>;
  }
  return (
    <ul className="mb-1">
      {comments.map((comment) => {
        const suggestion = comment.suggestion;
        const hidden = suggestion ? dismissed.includes(suggestion.id) : false;
        const picked = suggestion
          ? suggestion.kind === "flight"
            ? lockedFlightId === suggestion.optionId
            : lockedStayId === suggestion.optionId
          : false;
        return (
          <li key={comment.id} className="mb-3.5 flex gap-2.5">
            <Avatar name={comment.name} index={comment.memberIndex} />
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 flex items-baseline gap-2">
                <span className="text-[12.5px] font-bold">{comment.name}</span>
                <span className="text-[11px] text-[#A69E8D]">{comment.at ? ago(comment.at, now) : comment.timeLabel}</span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-[#756E60]">{comment.text}</p>
              {suggestion && !hidden ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-[#EAE3D4] bg-white">
                  <p className="flex items-center gap-1.5 bg-[#E9F0F8] px-3 py-1.5 text-[11px] font-bold text-[#3A6EA5]">
                    {suggestion.kind === "flight" ? <PlaneIcon className="h-3 w-3" /> : <HouseIcon className="h-3 w-3" />}
                    Suggested {suggestion.kind === "flight" ? "flight" : "stay"}
                  </p>
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <span className="relative h-11 w-[52px] shrink-0 overflow-hidden rounded-lg">
                      <Image src={suggestion.image} alt="" fill sizes="52px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold">{suggestion.title}</span>
                      <span className="block truncate text-[11.5px] text-[#A69E8D]">{suggestion.meta}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-extrabold">{suggestion.priceLabel}</span>
                  </div>
                  <div className="flex gap-2 px-3 pb-3">
                    <button
                      type="button"
                      onClick={() => onAccept(suggestion)}
                      disabled={picked}
                      className="h-11 rounded-lg bg-[#F0416A] px-3 text-[11.5px] font-bold text-white disabled:opacity-70"
                    >
                      {picked ? "On the shortlist" : "Add to shortlist"}
                    </button>
                    {picked ? null : (
                      <button
                        type="button"
                        onClick={() => onDismiss(suggestion.id)}
                        className="h-11 rounded-lg border border-[#DCD3BE] bg-white px-3 text-[11.5px] font-bold"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Composer({
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-[#DCD3BE] px-3 text-[12.5px] outline-none focus:border-[#F0416A]"
        />
        <button
          type="submit"
          aria-label="Post comment"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[#DCD3BE] bg-white text-[#756E60] hover:bg-[#F4EFE6]"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-[#A69E8D]">
        Attaching a link or photo turns your comment into a suggested option the group can vote on.
      </p>
    </form>
  );
}

function AvatarStack({ members }: { members: Member[] }) {
  const shown = members.slice(0, 2);
  const rest = members.length - shown.length;
  return (
    <div className="hidden shrink-0 sm:flex">
      {shown.map((member, index) => (
        <Avatar key={member.id} name={memberLabel(member, index)} index={index} overlap={index > 0} />
      ))}
      {rest > 0 ? (
        <span className="-ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#EFE3D9] text-[11.5px] font-bold text-[#8A6A31]">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

function Avatar({
  name,
  index,
  size = "md",
  overlap = false,
}: {
  name: string;
  index: number;
  size?: "sm" | "md";
  overlap?: boolean;
}) {
  const tone = TONES[index % TONES.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white font-bold",
        size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11.5px]",
        overlap && "-ml-1.5",
      )}
      style={{ background: tone.bg, color: tone.color }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function memberLabel(member: Member | undefined, index: number): string {
  const named = member?.name.trim();
  return named || `Person ${index + 1}`;
}

function cheapest(flights: FlightOption[]): FlightOption | null {
  return [...flights].sort((a, b) => a.price - b.price)[0] ?? null;
}

function topRated(stays: StayOption[]): StayOption | null {
  return [...stays].sort((a, b) => b.rating - a.rating)[0] ?? null;
}

function seedFlightComment(members: Member[], flight: FlightOption): Comment {
  return {
    id: "seed-flight",
    memberIndex: 0,
    name: memberLabel(members[0], 0),
    text: `Leaning ${flight.airline} at ${money(flight.price)}${flight.stops === "Nonstop" ? ", nonstop" : ""}.`,
    at: null,
    timeLabel: "1h ago",
  };
}

function seedStayComment(members: Member[], stay: StayOption, stays: StayOption[]): Comment | null {
  const authorIndex = Math.min(2, members.length - 1);
  if (authorIndex < 1) return null;
  const alternate = [...stays].filter((item) => item.id !== stay.id).sort((a, b) => a.price - b.price)[0];
  const name = memberLabel(members[authorIndex], authorIndex);
  if (!alternate) {
    return {
      id: "seed-stay",
      memberIndex: authorIndex,
      name,
      text: `${stay.name} looks right for the group.`,
      at: null,
      timeLabel: "30m ago",
    };
  }
  return {
    id: "seed-stay",
    memberIndex: authorIndex,
    name,
    text: `${alternate.name} is closer to the neighborhood we keep coming back to — thoughts?`,
    at: null,
    timeLabel: "18m ago",
    suggestion: {
      id: `stay-${alternate.id}`,
      kind: "stay",
      optionId: alternate.id,
      title: alternate.name,
      meta: `${alternate.neighborhood} · ${alternate.rating.toFixed(2)} · ${alternate.reviews} reviews`,
      priceLabel: `${money(alternate.price)}/nt`,
      image: alternate.image,
    },
  };
}

/** Cheapest fare that is not already the leading card, voiced by the second member. */
function buildLiveFlightComment(state: TripState): { comment: Comment; activity: string } | null {
  const flights = flightsFor(state.destinationId);
  const leading = findFlight(state.destinationId, state.lockedFlightId) ?? cheapest(flights);
  if (!leading) return null;
  const other = flights.filter((item) => item.id !== leading.id).sort((a, b) => a.price - b.price)[0];
  if (!other) return null;
  const name = memberLabel(state.members[1], 1);
  const cheaper = other.price < leading.price;
  const at = Date.now();
  return {
    activity: `${name} suggested a ${cheaper ? "cheaper " : ""}flight in the comments`,
    comment: {
      id: "live-flight",
      memberIndex: 1,
      name,
      at,
      text: cheaper
        ? `Found one that's ${money(leading.price - other.price)} less${other.stops === "Nonstop" ? " and still nonstop" : ""} — worth a look?`
        : `What about ${other.airline}? ${other.stops}, ${other.duration}.`,
      suggestion: {
        id: `flight-${other.id}`,
        kind: "flight",
        optionId: other.id,
        title: `${other.airline} · ${other.stops.toLowerCase()}`,
        meta: `${other.from} → ${other.to} · ${other.duration}`,
        priceLabel: money(other.price),
        image: other.image,
      },
    },
  };
}

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function PlaneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function HouseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 22V10l9-6 9 6v12" />
      <path d="M9 22V14h6v8" />
    </svg>
  );
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
