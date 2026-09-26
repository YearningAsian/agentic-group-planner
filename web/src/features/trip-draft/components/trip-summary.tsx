"use client";

/**
 * Current-trip dashboard (port of `Trip summary graph - Flights -> Hotel -> Invite.html`).
 * Reads the session draft from `useTrip` - destination, dates, locked flight/stay, and members -
 * and writes picks back through the same actions, so Picks and Progress stay in sync.
 * Comments are local to this screen and start empty until someone posts.
 * TODO: replace the simulated join with live trip-view events.
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
import { useTrip, type Member } from "@/features/trip-draft/trip-context";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { cn } from "@/lib/utils";

type Marker = "done" | "active" | "pending";
type Thread = "flight" | "stay";
type MemberChoice = { member: Member; index: number };

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
  /** Epoch ms. */
  at: number;
  suggestion?: Suggestion;
};

const TONES = [
  { bg: "#EFD9CE", color: "#8A4B31" },
  { bg: "#DCEBE3", color: "#2F7D5B" },
  { bg: "#EFE3D9", color: "#8A6A31" },
  { bg: "#E6DCF0", color: "#6B3FA0" },
] as const;

const CARD_SHADOW = "var(--shadow)";

export function TripSummary() {
  const { state } = useTrip();
  const destination = destinationById(state.destinationId);
  if (!destination) return <EmptySummary />;
  return <SummaryBody key={destination.id} />;
}

function EmptySummary() {
  return (
    <AppShell>
      <div className="min-h-full bg-bg text-ink">
      <div className="mx-auto max-w-[760px] px-5 py-8">
        <section className="rounded-[20px] border border-line bg-surface p-6" style={{ boxShadow: CARD_SHADOW }}>
          <h2 className="text-[18px] font-bold tracking-tight">No trip selected</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Answer the questions and this page fills in with flights, a stay, and who has joined.
          </p>
          <Link
            href="/onboarding"
            className="mt-5 inline-flex h-11 items-center rounded-[9px] bg-ink px-4 text-[13px] font-bold text-white hover:bg-[#302a22]"
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
  const joinedChoices: MemberChoice[] = state.members
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => member.joined);
  const joined = joinedChoices.map(({ member }) => member);
  const flight = leadingOption(flights, joined, "flightId", state.lockedFlightId, cheapest);
  const stay = leadingOption(stays, joined, "stayId", state.lockedStayId, topRated);
  const allJoinedHaveFlight = joined.length > 0 && joined.every((member) => Boolean(member.flightId));
  const allJoinedHaveStay = joined.length > 0 && joined.every((member) => Boolean(member.stayId));
  const sameFlightId = allJoinedHaveFlight && joined.every((member) => member.flightId === joined[0]?.flightId) ? joined[0]?.flightId ?? null : null;
  const sameStayId = allJoinedHaveStay && joined.every((member) => member.stayId === joined[0]?.stayId) ? joined[0]?.stayId ?? null : null;
  const lockedFlight = findFlight(state.destinationId, sameFlightId);
  const lockedStay = findStay(state.destinationId, sameStayId);

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
  const [copied, setCopied] = useState(false);
  const [suggesting, setSuggesting] = useState<Thread | null>(null);

  const joinSeen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!suggesting) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSuggesting(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [suggesting]);

  // Same join beat as Progress: once everyone joined has both picks, the next pending person joins.
  const inviteReached = allJoinedHaveFlight && allJoinedHaveStay;
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

  const flightComments = posted.filter((item) => item.thread === "flight");
  const stayComments = posted.filter((item) => item.thread === "stay");

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

  const flightMarker: Marker = allJoinedHaveFlight ? "done" : flights.length > 0 ? "active" : "pending";
  const stayMarker: Marker = allJoinedHaveStay ? "done" : allJoinedHaveFlight ? "active" : "pending";
  const inviteMarker: Marker = !inviteReached ? "pending" : state.inviteShared ? "done" : "active";
  const flightPickCount = new Set(joined.map((member) => member.flightId).filter(Boolean)).size;
  const stayPickCount = new Set(joined.map((member) => member.stayId).filter(Boolean)).size;

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

  function assignPickedFlight(member: Member, memberIndex: number, picked: FlightOption) {
    if (member.flightId === picked.id) return;
    if (member.id === state.members[0]?.id) {
      trip.lockFlight(picked.id);
    } else {
      trip.assignFlight(member.id, picked.id);
    }
    note(`${memberLabel(member, memberIndex)} picked ${picked.airline}`);
  }

  function assignPickedStay(member: Member, memberIndex: number, picked: StayOption) {
    if (member.stayId === picked.id) return;
    if (member.id === state.members[0]?.id) {
      trip.lockStay(picked.id);
    } else {
      trip.assignStay(member.id, picked.id);
    }
    note(`${memberLabel(member, memberIndex)} picked ${picked.name}`);
  }

  function assignSuggestion(member: Member, memberIndex: number, suggestion: Suggestion) {
    if (suggestion.kind === "flight") {
      const picked = findFlight(state.destinationId, suggestion.optionId);
      if (picked) assignPickedFlight(member, memberIndex, picked);
    } else {
      const picked = findStay(state.destinationId, suggestion.optionId);
      if (picked) assignPickedStay(member, memberIndex, picked);
    }
  }

  function postSuggestion(thread: Thread, option: FlightOption | StayOption) {
    const at = Date.now();
    const suggestion = thread === "flight" ? flightSuggestion(option as FlightOption) : staySuggestion(option as StayOption);
    setPosted((current) => [
      ...current,
      {
        id: `suggest-${at}`,
        thread,
        memberIndex: 0,
        name: memberLabel(state.members[0], 0),
        text: thread === "flight" ? "Found another flight that could work." : "Found another stay for the group to compare.",
        at,
        suggestion,
      },
    ]);
    if (thread === "flight") setFlightTalkOpen(true);
    if (thread === "stay") setStayTalkOpen(true);
    setSuggesting(null);
    note(`${memberLabel(state.members[0], 0)} suggested ${thread === "flight" ? suggestion.title : "a stay"}`);
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
      <div className="min-h-full bg-bg text-ink">
      <div className="mx-auto max-w-[760px] px-5 pt-6 pb-20">
        <div
          className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-line bg-surface px-[18px] py-3.5 sm:flex-nowrap"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <div className="min-w-0 w-full sm:w-auto sm:flex-1">
            <h2 className="truncate text-[16px] font-bold">
              {destination.label} · {formatRange(state.startDate, state.endDate)}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-ink-faint">Trip summary updates as the group chats and answers questions</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-good-tint px-2.5 py-1 text-[11.5px] font-bold text-success">
            <span className="trip-live-dot h-1.5 w-1.5 rounded-full bg-success" />
            Live
          </span>
          <AvatarStack members={state.members} />
          <button
            type="button"
            onClick={() => void shareLink()}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[12.5px] font-bold text-white hover:bg-[#302a22]"
          >
            <PenIcon className="h-3.5 w-3.5" />
            Share
          </button>
        </div>

        <p className="flex items-center gap-2 px-1 py-3.5 pb-5 text-[12px] text-ink-faint" aria-live="polite">
          <ClockIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span>
            Updated {ago(stamp, now)}. <b className="font-bold text-muted">{detail}</b>
          </span>
        </p>

        <div className="relative">
          <div
            className="absolute top-3.5 bottom-3.5 left-[27px] w-0.5"
            style={{ background: "repeating-linear-gradient(to bottom, var(--line-soft) 0 6px, transparent 6px 12px)" }}
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
                  : allJoinedHaveFlight
                    ? `${flightPickCount} ${flightPickCount === 1 ? "flight" : "flights"}`
                    : flights.length > 0
                      ? `${flights.length} options · group deciding`
                    : "No fares yet"
              }
              current={flightMarker === "active"}
            >
              {flight ? (
                <section className="overflow-hidden rounded-[20px] border border-line bg-surface" style={{ boxShadow: CARD_SHADOW }}>
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
                                ? "right-[14%] z-30 border-line-soft bg-surface text-ink"
                                : "border-line-soft bg-bg-muted text-muted",
                              depth === 1 && "right-[8%] z-20 translate-y-3 -rotate-[1.2deg] scale-[0.98]",
                              depth === 2 && "right-[2%] z-10 translate-y-[22px] rotate-[1.4deg] scale-[0.96]",
                            )}
                            style={front ? { boxShadow: CARD_SHADOW } : undefined}
                          >
                            <span className="mr-2.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
                              <PlaneIcon className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate">
                              {item.airline} · {money(item.price)}
                              {front && item.stops === "Nonstop" ? ", nonstop" : ""}
                            </span>
                            {front ? (
                              <span className="ml-auto shrink-0 rounded-full bg-good-tint px-2 py-0.5 text-[10.5px] font-extrabold text-success">
                                {lockedFlight ? "Locked" : flightPickCount > 1 ? "Most picked" : "Leading"}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <span className="flex items-center justify-between text-[12px] text-ink-faint">
                      <span>
                        {flights.length} shortlisted, {joined.filter((member) => member.flightId).length} of {joined.length} joined picked
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
                        const picked = joined.some((member) => member.flightId === item.id);
                        const leading = item.id === flight.id;
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "mb-2.5 flex items-center gap-3 rounded-xl border px-3 py-3",
                              leading ? "border-[#cfe7da] bg-good-tint" : "border-line bg-surface",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border text-accent",
                                leading ? "border-[#cfe7da] bg-surface" : "border-line bg-surface",
                              )}
                            >
                              <PlaneIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-bold">
                                {item.airline}
                                {item.stops === "Nonstop" ? " · nonstop" : ""}
                              </span>
                              <span className="mt-px block truncate text-[11.5px] text-muted">
                                {item.from} → {item.to} · {item.duration}
                                {item.stops !== "Nonstop" ? ` · ${item.stops}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-[14px] font-semibold tabular-nums">{money(item.price)}</span>
                            <MemberChoiceStrip
                              choices={joinedChoices}
                              optionId={item.id}
                              kind="flight"
                              onChoose={(choice) => assignPickedFlight(choice.member, choice.index, item)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  <Discuss
                    count={flightComments.length}
                    open={flightTalkOpen}
                    onToggle={() => setFlightTalkOpen((open) => !open)}
                  >
                    <CommentList
                      comments={flightComments}
                      now={now}
                      dismissed={dismissed}
                      choices={joinedChoices}
                      onAssign={assignSuggestion}
                      onDismiss={(id) => setDismissed((current) => [...current, id])}
                    />
                    <Composer
                      value={drafts.flight}
                      placeholder="Comment, or paste a flight link to suggest it…"
                      onChange={(value) => setDrafts((current) => ({ ...current, flight: value }))}
                      onSubmit={() => post("flight")}
                      onSuggest={() => setSuggesting("flight")}
                    />
                  </Discuss>
                </section>
              ) : (
                <p className="text-[14px] text-muted">Fares show up after a destination is confirmed.</p>
              )}
            </SummaryNode>

            <SummaryNode
              marker={stayMarker}
              icon={<HouseIcon className="h-[22px] w-[22px]" />}
              title="Hotel / Airbnb"
              status={
                lockedStay
                  ? "Locked in"
                  : allJoinedHaveStay
                    ? `${stayPickCount} ${stayPickCount === 1 ? "stay" : "stays"}`
                    : stay
                      ? `1 leading · ${alternates.length} ${alternates.length === 1 ? "alternate" : "alternates"}`
                      : "Waiting on a stay"
              }
              current={stayMarker === "active"}
            >
              {stay ? (
                <section className="overflow-hidden rounded-[20px] border border-line bg-surface" style={{ boxShadow: CARD_SHADOW }}>
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
                      <span className="shrink-0 rounded-full bg-good-tint px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-success">
                        {lockedStay ? "Locked in" : stayPickCount > 1 ? "Most picked" : "Leading pick"}
                      </span>
                    </div>
                    <p className="mb-3.5 text-[12.5px] text-muted">
                      {stay.neighborhood} · {state.members.length} guests · {formatRange(state.startDate, state.endDate)}
                    </p>
                    <div className="flex items-center justify-between pb-4">
                      <p className="text-[15px] font-semibold tabular-nums">
                        {money(stay.price)} <span className="text-[12px] font-medium text-ink-faint">/ night</span>
                      </p>
                      <MemberChoiceStrip
                        choices={joinedChoices}
                        optionId={stay.id}
                        kind="stay"
                        onChoose={(choice) => assignPickedStay(choice.member, choice.index, stay)}
                      />
                    </div>
                  </div>
                  {alternates.length > 0 ? (
                    <div className="px-5 pb-4">
                      <p className="mb-2 text-[11.5px] text-ink-faint">Also considering</p>
                      <div className="flex flex-col gap-2">
                        {alternates.map((item) => (
                          <div key={item.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg-muted px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-muted">
                              {item.name} ({money(item.price)}/night)
                            </span>
                            <MemberChoiceStrip
                              choices={joinedChoices}
                              optionId={item.id}
                              kind="stay"
                              onChoose={(choice) => assignPickedStay(choice.member, choice.index, item)}
                            />
                          </div>
                        ))}
                      </div>
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
                      choices={joinedChoices}
                      onAssign={assignSuggestion}
                      onDismiss={(id) => setDismissed((current) => [...current, id])}
                    />
                    <Composer
                      value={drafts.stay}
                      placeholder="Comment, or paste a listing link to suggest it…"
                      onChange={(value) => setDrafts((current) => ({ ...current, stay: value }))}
                      onSubmit={() => post("stay")}
                      onSuggest={() => setSuggesting("stay")}
                    />
                  </Discuss>
                </section>
              ) : (
                <p className="text-[14px] text-muted">Stays show up after a destination is confirmed.</p>
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
              <section className="rounded-[20px] border border-line bg-surface" style={{ boxShadow: CARD_SHADOW }}>
                <div className="px-5 py-[18px]">
                  <div className="mb-3.5 flex items-center gap-2.5 rounded-xl border border-dashed border-line-soft bg-bg-muted py-2.5 pr-2.5 pl-3.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted">{link}</span>
                    <button
                      type="button"
                      onClick={() => void copyLink()}
                      className="h-11 shrink-0 rounded-lg bg-ink px-3 text-[11.5px] font-bold text-white hover:bg-[#302a22]"
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
                              on ? "bg-good-tint text-success" : "bg-warn-tint text-warning",
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
                    <p className="mt-3 text-[13px] font-semibold text-success">{state.justJoinedName} just joined.</p>
                  ) : null}
                </div>
              </section>
            </SummaryNode>
          </ol>
        </div>
      </div>
      </div>
      {suggesting ? (
        <SuggestionPanel
          thread={suggesting}
          options={suggesting === "flight" ? flights.filter((item) => item.id !== flight?.id) : stays.filter((item) => item.id !== stay?.id)}
          onClose={() => setSuggesting(null)}
          onSuggest={(option) => postSuggestion(suggesting, option)}
        />
      ) : null}
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
            "relative z-[1] flex h-14 w-14 items-center justify-center rounded-2xl border bg-surface",
            marker === "done" && "border-[#cfe7da] bg-good-tint text-success",
            marker === "active" && "border-[#f8c9d5] bg-accent-tint text-accent",
            marker === "pending" && "border-line text-ink-faint",
          )}
          style={{ boxShadow: CARD_SHADOW }}
        >
          {icon}
        </div>
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1.5" : "pb-8")}>
        <div className="mb-2.5 flex items-center gap-2.5 pt-3">
          <h2 className="text-[15.5px] font-extrabold tracking-tight">{title}</h2>
          <span className="ml-auto text-[12px] font-semibold text-ink-faint">{status}</span>
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
        className="flex min-h-11 w-full items-center gap-2 border-t border-line bg-bg-muted px-5 py-3 text-[12.5px] font-bold text-muted"
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
  choices,
  onAssign,
  onDismiss,
}: {
  comments: Comment[];
  now: number;
  dismissed: string[];
  choices: MemberChoice[];
  onAssign: (member: Member, memberIndex: number, suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
}) {
  if (comments.length === 0) {
    return <p className="mb-3 text-[12.5px] text-ink-faint">No comments yet. The group thread shows up here.</p>;
  }
  return (
    <ul className="mb-1">
      {comments.map((comment) => {
        const suggestion = comment.suggestion;
        const hidden = suggestion ? dismissed.includes(suggestion.id) : false;
        const picked = suggestion ? choices.some(({ member }) => choiceId(member, suggestion.kind) === suggestion.optionId) : false;
        return (
          <li key={comment.id} className="mb-3.5 flex gap-2.5">
            <Avatar name={comment.name} index={comment.memberIndex} />
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 flex items-baseline gap-2">
                <span className="text-[12.5px] font-bold">{comment.name}</span>
                <span className="text-[11px] text-ink-faint">{ago(comment.at, now)}</span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted">{comment.text}</p>
              {suggestion && !hidden ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
                  <p className="flex items-center gap-1.5 bg-info-tint px-3 py-1.5 text-[11px] font-bold text-info">
                    {suggestion.kind === "flight" ? <PlaneIcon className="h-3 w-3" /> : <HouseIcon className="h-3 w-3" />}
                    Suggested {suggestion.kind === "flight" ? "flight" : "stay"}
                  </p>
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <span className="relative h-11 w-[52px] shrink-0 overflow-hidden rounded-lg">
                      <Image src={suggestion.image} alt="" fill sizes="52px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold">{suggestion.title}</span>
                      <span className="block truncate text-[11.5px] text-ink-faint">{suggestion.meta}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{suggestion.priceLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-3">
                    <MemberChoiceStrip
                      choices={choices}
                      optionId={suggestion.optionId}
                      kind={suggestion.kind}
                      onChoose={(choice) => onAssign(choice.member, choice.index, suggestion)}
                    />
                    {picked ? null : (
                      <button
                        type="button"
                        onClick={() => onDismiss(suggestion.id)}
                        className="h-11 rounded-lg border border-line-soft bg-surface px-3 text-[11.5px] font-bold"
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
  onSuggest,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSuggest: () => void;
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
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-soft bg-surface px-3 text-[12.5px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          aria-label="Post comment"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-line-soft bg-surface text-muted hover:bg-bg-muted"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSuggest}
          className="h-11 shrink-0 rounded-[10px] bg-ink px-3 text-[11.5px] font-bold text-white hover:bg-[#302a22]"
        >
          Suggest
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Attaching a link or photo turns your comment into a suggested option the group can vote on.
      </p>
    </form>
  );
}

function MemberChoiceStrip({
  choices,
  optionId,
  kind,
  onChoose,
}: {
  choices: MemberChoice[];
  optionId: string;
  kind: Thread;
  onChoose: (choice: MemberChoice) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label={`Choose ${kind === "flight" ? "flight" : "stay"} by person`}>
      {choices.map((choice) => {
        const name = memberLabel(choice.member, choice.index);
        const selected = choiceId(choice.member, kind) === optionId;
        return (
          <button
            key={choice.member.id}
            type="button"
            aria-pressed={selected}
            title={`${name}: ${selected ? "picked" : "pick this"}`}
            onClick={() => onChoose(choice)}
            className={cn(
              "rounded-full p-0.5 transition",
              selected ? "bg-success ring-2 ring-success/20" : "border border-dashed border-line-soft bg-surface opacity-70 hover:opacity-100",
            )}
          >
            <Avatar name={name} index={choice.index} size="sm" />
            <span className="sr-only">
              {selected ? `${name} picked this ${kind}` : `Pick this ${kind} for ${name}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SuggestionPanel({
  thread,
  options,
  onClose,
  onSuggest,
}: {
  thread: Thread;
  options: Array<FlightOption | StayOption>;
  onClose: () => void;
  onSuggest: (option: FlightOption | StayOption) => void;
}) {
  const title = thread === "flight" ? "Suggest a new flight" : "Suggest a new stay";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close suggestions" className="absolute inset-0 cursor-default" onClick={onClose} />
      <aside className="relative flex h-full w-[min(100%,380px)] flex-col overflow-hidden border-l border-line bg-surface shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[11px] font-bold tracking-wide text-ink-faint uppercase">Right-side suggestion</p>
              <h2 className="text-[18px] font-extrabold tracking-tight">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg border border-line-soft px-3 text-[12px] font-bold">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-4">
            {options.map((option) => {
              const isFlight = thread === "flight";
              const flight = option as FlightOption;
              const stay = option as StayOption;
              return (
                <article key={option.id} className="overflow-hidden rounded-[18px] border border-line bg-bg-muted">
                  <div className="relative h-36">
                    <Image src={option.image} alt="" fill sizes="380px" className="object-cover" />
                  </div>
                  <div className="p-4">
                    <p className="text-[11px] font-bold tracking-wide text-accent uppercase">{isFlight ? "Flight option" : "Stay option"}</p>
                    <h3 className="mt-1 text-[16px] font-extrabold">{isFlight ? flight.airline : stay.name}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                      {isFlight
                        ? `${flight.from} → ${flight.to} · ${flight.depart} – ${flight.arrive} · ${flight.duration}`
                        : `${stay.neighborhood} · ${stay.rating.toFixed(2)} · ${stay.reviews} reviews`}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-[17px] font-semibold tabular-nums">{isFlight ? money(flight.price) : `${money(stay.price)}/nt`}</span>
                      <button
                        type="button"
                        onClick={() => onSuggest(option)}
                        className="h-11 rounded-lg bg-accent px-4 text-[12px] font-bold text-white hover:bg-accent-hover"
                      >
                        Suggest this
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
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
        <span className="-ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#efe3d9] text-[11.5px] font-bold text-[#8a6a31]">
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

function choiceId(member: Member, kind: Thread): string | null {
  return kind === "flight" ? member.flightId ?? null : member.stayId ?? null;
}

function leadingOption<T extends { id: string }>(
  options: T[],
  members: Member[],
  key: "flightId" | "stayId",
  organizerPickId: string | null,
  fallback: (options: T[]) => T | null,
): T | null {
  const counts = new Map<string, number>();
  for (const member of members) {
    const id = member[key];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return organizerPickId ? options.find((option) => option.id === organizerPickId) ?? fallback(options) : fallback(options);
  return [...options].sort((a, b) => {
    const count = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    if (count !== 0) return count;
    if (organizerPickId) {
      if (a.id === organizerPickId) return -1;
      if (b.id === organizerPickId) return 1;
    }
    return 0;
  })[0] ?? fallback(options);
}

function flightSuggestion(option: FlightOption): Suggestion {
  return {
    id: `flight-${option.id}-${Date.now()}`,
    kind: "flight",
    optionId: option.id,
    title: `${option.airline} · ${option.stops.toLowerCase()}`,
    meta: `${option.from} → ${option.to} · ${option.depart} – ${option.arrive} · ${option.duration}`,
    priceLabel: money(option.price),
    image: option.image,
  };
}

function staySuggestion(option: StayOption): Suggestion {
  return {
    id: `stay-${option.id}-${Date.now()}`,
    kind: "stay",
    optionId: option.id,
    title: option.name,
    meta: `${option.neighborhood} · ${option.rating.toFixed(2)} · ${option.reviews} reviews`,
    priceLabel: `${money(option.price)}/nt`,
    image: option.image,
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
