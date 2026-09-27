"use client";

/**
 * Current-trip dashboard. Layout follows the Kyoto summary skeleton; colors stay on trip-draft tokens.
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
import { formatMoney, formatRange, initials, money } from "@/features/trip-draft/format";
import { useTrip, type Member } from "@/features/trip-draft/trip-context";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { GroupBuy } from "@/features/trip-draft/components/group-buy";
import { TripMap } from "@/features/trip-draft/components/trip-map";
import type { MapMarker } from "@/features/trip-draft/components/fallback-map";
import { cn } from "@/lib/utils";

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

const PIN_OFFSETS = [
  { lng: 0.018, lat: 0.012 },
  { lng: -0.022, lat: -0.006 },
  { lng: 0.008, lat: -0.016 },
] as const;

const TONES = [
  { bg: "#EFD9CE", color: "#8A4B31" },
  { bg: "#DCEBE3", color: "#2F7D5B" },
  { bg: "#EFE3D9", color: "#8A6A31" },
  { bg: "#E6DCF0", color: "#6B3FA0" },
] as const;

const CARD_SHADOW = "var(--shadow)";

/** Epoch ms outside render so nested event handlers stay pure for react-hooks/purity. */
function nowMs(): number {
  return Date.now();
}

function uniqueId(prefix: string): string {
  return `${prefix}-${nowMs()}`;
}

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
  const liveFlight = state.chosenFlight && state.chosenFlight.id === state.lockedFlightId ? state.chosenFlight : null;
  const liveStay = state.chosenStay && state.chosenStay.id === state.lockedStayId ? state.chosenStay : null;

  function pricedFlight(member: Member) {
    if (liveFlight && member.flightId === liveFlight.id) {
      return {
        airline: liveFlight.airline,
        route: `${liveFlight.origin} → ${liveFlight.destination}`,
        price: liveFlight.price,
        currency: liveFlight.currency,
      };
    }
    const picked = findFlight(state.destinationId, member.flightId ?? null);
    if (!picked) return null;
    return { airline: picked.airline, route: `${picked.from} → ${picked.to}`, price: picked.price, currency: "USD" };
  }

  function pricedStay(member: Member) {
    if (liveStay && member.stayId === liveStay.id) {
      return { name: liveStay.name, price: liveStay.nightlyAmount, currency: liveStay.currency ?? "USD" };
    }
    const picked = findStay(state.destinationId, member.stayId ?? null);
    if (!picked) return null;
    return { name: picked.name, price: picked.price, currency: "USD" };
  }

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
  const [staysOpen, setStaysOpen] = useState(false);
  const [flightTalkOpen, setFlightTalkOpen] = useState(false);
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

  if (!destination) return null;

  const detail =
    activity?.detail ??
    (state.justJoinedName
      ? `${state.justJoinedName} joined the trip`
      : liveStay
        ? `${liveStay.name} is locked in`
        : lockedStay
        ? `${lockedStay.name} is locked in`
        : liveFlight
          ? `${liveFlight.airline} is the leading flight`
          : lockedFlight
          ? `${lockedFlight.airline} is the leading flight`
          : `${destination.label} is the current trip`);
  const stamp = activity?.at ?? openedAt;

  const flightPickCount = new Set(joined.map((member) => member.flightId).filter(Boolean)).size;
  const stayPickCount = new Set(joined.map((member) => member.stayId).filter(Boolean)).size;

  function note(next: string) {
    const at = nowMs();
    setActivity({ detail: next, at });
    setNow(at);
  }

  function post(thread: Thread) {
    const text = drafts[thread].trim();
    if (!text) return;
    const at = nowMs();
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

  function assignLiveFlight(member: Member, memberIndex: number) {
    if (!liveFlight || member.flightId === liveFlight.id) return;
    if (member.id === state.members[0]?.id) {
      trip.lockFlight(liveFlight.id);
    } else {
      trip.assignFlight(member.id, liveFlight.id);
    }
    note(`${memberLabel(member, memberIndex)} picked ${liveFlight.airline}`);
  }

  function assignLiveStay(member: Member, memberIndex: number) {
    if (!liveStay || member.stayId === liveStay.id) return;
    if (member.id === state.members[0]?.id) {
      trip.lockStay(liveStay.id);
    } else {
      trip.assignStay(member.id, liveStay.id);
    }
    note(`${memberLabel(member, memberIndex)} picked ${liveStay.name}`);
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
    const at = nowMs();
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
  const otherStays = stays.filter((item) => item.id !== stay?.id);
  const markers: MapMarker[] = [
    {
      id: `airport-${destination.id}`,
      label: destination.code,
      lng: destination.lng,
      lat: destination.lat,
      title: `${destination.label} (${destination.code})`,
    },
    ...stays.map((item, index) => {
      const offset = PIN_OFFSETS[index % PIN_OFFSETS.length];
      const guests = joinedChoices
        .filter(({ member }) => member.stayId === item.id)
        .map(({ member, index: memberIndex }) => memberLabel(member, memberIndex));
      return {
        id: item.id,
        label: item.name,
        lng: destination.lng + offset.lng,
        lat: destination.lat + offset.lat,
        selected: item.id === stay?.id,
        title: guests.length > 0 ? guests.join(", ") : "Nobody staying here yet",
      };
    }),
  ];

  return (
    <AppShell>
      <div className="min-h-full bg-bg text-ink">
      <div className="mx-auto max-w-[960px] px-5 pt-6 pb-20">
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

                <div className="mb-4 h-[340px] overflow-hidden rounded-[16px] border border-line">
          <TripMap focus={destination} pinned markers={markers} />
        </div>

        <section className="mb-4 rounded-[20px] border border-line bg-surface px-5 py-[18px]" style={{ boxShadow: CARD_SHADOW }}>
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-bold">Cost per person</h2>
            <span className="text-[12px] text-ink-faint">Flight + hotel share</span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {state.members.map((member, index) => {
              const name = memberLabel(member, index);
              const pickedFlight = pricedFlight(member);
              const pickedStay = pricedStay(member);
              const ready = Boolean(member.joined && pickedFlight && pickedStay && pickedStay.price != null);
              const hasFlight = Boolean(pickedFlight);
              const hasStay = Boolean(pickedStay);
              const detailTone =
                member.joined && hasFlight && hasStay
                  ? "text-[#1e7b4a]"
                  : !member.joined || hasFlight || hasStay
                    ? "text-[#a89f00]"
                    : "text-[#c62828]";
              const detail =
                [pickedFlight?.airline, pickedStay?.name].filter(Boolean).join(" + ") ||
                (member.joined ? "No flight or stay yet" : "Waiting to join");
              const flightShare = pickedFlight ? formatMoney(pickedFlight.price, pickedFlight.currency) : "";
              const stayShare = pickedStay?.price != null ? formatMoney(pickedStay.price, pickedStay.currency) : "";
              const sameCurrency = Boolean(pickedFlight && pickedStay?.price != null && pickedFlight.currency === pickedStay.currency);
              const badge = index === 0 ? "Organizer" : member.joined ? "Joined" : "Invited";
              const on = index === 0 || member.joined;
              return (
                <PersonRow
                  key={member.id}
                  name={name}
                  index={index}
                  title={name}
                  detail={detail}
                  detailClassName={detailTone}
                  amount={
                    ready && pickedFlight && pickedStay?.price != null
                      ? sameCurrency
                        ? formatMoney(pickedFlight.price + pickedStay.price, pickedFlight.currency)
                        : flightShare
                      : undefined
                  }
                  split={ready ? `${flightShare} + ${stayShare}` : undefined}
                  pending={member.joined ? "Not picked yet" : null}
                  trailing={
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                        on ? "bg-good-tint text-success" : "bg-warn-tint text-warning",
                      )}
                    >
                      {badge}
                    </span>
                  }
                />
              );
            })}
          </ul>
          <div className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-dashed border-line-soft bg-bg-muted py-2.5 pr-2.5 pl-3.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted">{link}</span>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="h-11 shrink-0 rounded-lg bg-ink px-3 text-[11.5px] font-bold text-white hover:bg-[#302a22]"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copied ? "Invite link copied." : ""}
            {state.justJoinedName ? `${state.justJoinedName} joined the trip.` : ""}
          </p>
          {state.justJoinedName ? (
            <p className="mt-3 text-[13px] font-semibold text-success">{state.justJoinedName} just joined.</p>
          ) : null}
        </section>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="overflow-hidden rounded-[20px] border border-line bg-surface px-5 py-[18px]" style={{ boxShadow: CARD_SHADOW }}>
            <div className="mb-3.5 flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-bold">Flights</h2>
              {liveFlight ? (
                <span className="shrink-0 rounded-full bg-good-tint px-2.5 py-1 text-[11px] font-bold text-success">
                  {liveFlight.airline} · Locked
                </span>
              ) : lockedFlight ? (
                <span className="shrink-0 rounded-full bg-good-tint px-2.5 py-1 text-[11px] font-bold text-success">
                  {lockedFlight.airline} · Locked
                </span>
              ) : (
                <span className="text-right text-[12px] text-ink-faint">
                  {allJoinedHaveFlight
                    ? `${flightPickCount} ${flightPickCount === 1 ? "flight" : "flights"}`
                    : flights.length > 0
                      ? `${flights.length} options · group deciding`
                      : "No fares yet"}
                </span>
              )}
            </div>
            {flight || liveFlight ? (
              <>
                {liveFlight ? (
                  <div className="mb-3">
                    <p className="text-[13px] font-bold">{liveFlight.airline}</p>
                    <p className="text-[13.5px] font-semibold">
                      {liveFlight.origin} → {liveFlight.destination}
                    </p>
                    <p className="text-[12.5px] text-muted">
                      {offerClock(liveFlight.departure)} → {offerClock(liveFlight.arrival)} · {stopLabel(liveFlight.stops)}
                    </p>
                    <p className="mt-1 text-[14px] font-semibold tabular-nums">
                      {formatMoney(liveFlight.price, liveFlight.currency)}
                      <span className="text-[12px] font-medium text-muted"> / person</span>
                    </p>
                    <div className="mt-3 flex justify-end">
                      <MemberChoiceStrip
                        choices={joinedChoices}
                        optionId={liveFlight.id}
                        kind="flight"
                        onChoose={(choice) => assignLiveFlight(choice.member, choice.index)}
                      />
                    </div>
                  </div>
                ) : null}
                <ul className="flex flex-col gap-2.5">
                  {joinedChoices.map(({ member, index }) => {
                    const name = memberLabel(member, index);
                    const pickedFlight = pricedFlight(member);
                    return (
                      <PersonRow
                        key={member.id}
                        name={name}
                        index={index}
                        title={name}
                        detail={pickedFlight ? pickedFlight.route : "No flight yet"}
                        amount={pickedFlight ? formatMoney(pickedFlight.price, pickedFlight.currency) : undefined}
                      />
                    );
                  })}
                </ul>
                <button
                  type="button"
                  aria-expanded={flightsOpen}
                  onClick={() => setFlightsOpen((open) => !open)}
                  className="mt-3 flex min-h-11 w-full items-center justify-between text-left text-[12px] text-ink-faint"
                >
                  <span>
                    {flights.length} shortlisted, {joined.filter((member) => member.flightId).length} of {joined.length} joined picked
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1">
                    {flightsOpen ? "Hide" : "Show all"}
                    <ChevronIcon className={cn("h-3.5 w-3.5 transition-transform", flightsOpen && "rotate-180")} />
                  </span>
                </button>
                {flight && flightsOpen ? (
                  <ul className="mt-2">
                    {[flight, ...[...others].sort((a, b) => a.price - b.price)].map((item) => {
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
                <div className="-mx-5 mt-3">
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
                </div>
              </>
            ) : (
              <p className="text-[14px] text-muted">Fares show up after a destination is confirmed.</p>
            )}
          </section>

          <section className="rounded-[20px] border border-line bg-surface px-5 py-[18px]" style={{ boxShadow: CARD_SHADOW }}>
            <div className="mb-3.5 flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-bold">Hotels</h2>
              {liveStay ? (
                <span className="shrink-0 rounded-full bg-good-tint px-2.5 py-1 text-[11px] font-bold text-success">
                  {liveStay.name} · Locked
                </span>
              ) : lockedStay ? (
                <span className="shrink-0 rounded-full bg-good-tint px-2.5 py-1 text-[11px] font-bold text-success">
                  {lockedStay.name} · Locked
                </span>
              ) : (
                <span className="text-right text-[12px] text-ink-faint">
                  {allJoinedHaveStay
                    ? `${stayPickCount} ${stayPickCount === 1 ? "stay" : "stays"}`
                    : stays.length > 0
                      ? `${stays.length} options · group deciding`
                      : "No stays yet"}
                </span>
              )}
            </div>
            {stay || liveStay ? (
              <>
                {liveStay ? (
                  <div className="mb-3">
                    <p className="text-[13px] font-bold">{liveStay.name}</p>
                    <p className="text-[13.5px] font-semibold">{liveStay.area}</p>
                    <p className="mt-1 text-[14px] font-semibold tabular-nums">
                      {liveStay.nightlyAmount != null
                        ? formatMoney(liveStay.nightlyAmount, liveStay.currency ?? "USD")
                        : "Price unavailable"}
                      {liveStay.nightlyAmount != null ? (
                        <span className="text-[12px] font-medium text-muted"> / night</span>
                      ) : null}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <MemberChoiceStrip
                        choices={joinedChoices}
                        optionId={liveStay.id}
                        kind="stay"
                        onChoose={(choice) => assignLiveStay(choice.member, choice.index)}
                      />
                    </div>
                  </div>
                ) : null}
                <ul className="flex flex-col gap-2.5">
                  {joinedChoices.map(({ member, index }) => {
                    const name = memberLabel(member, index);
                    const pickedStay = pricedStay(member);
                    return (
                      <PersonRow
                        key={member.id}
                        name={name}
                        index={index}
                        title={name}
                        detail={pickedStay ? pickedStay.name : "No stay yet"}
                        amount={pickedStay?.price != null ? formatMoney(pickedStay.price, pickedStay.currency) : undefined}
                      />
                    );
                  })}
                </ul>
                <button
                  type="button"
                  aria-expanded={staysOpen}
                  onClick={() => setStaysOpen((open) => !open)}
                  className="mt-3 flex min-h-11 w-full items-center justify-between text-left text-[12px] text-ink-faint"
                >
                  <span>
                    {stays.length} shortlisted, {joined.filter((member) => member.stayId).length} of {joined.length} joined picked
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1">
                    {staysOpen ? "Hide" : "Show all"}
                    <ChevronIcon className={cn("h-3.5 w-3.5 transition-transform", staysOpen && "rotate-180")} />
                  </span>
                </button>
                {stay && staysOpen ? (
                  <ul className="mt-2">
                    {[stay, ...[...otherStays].sort((a, b) => a.price - b.price)].map((item) => {
                      const leading = item.id === stay.id;
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
                            <HouseIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold">{item.name}</span>
                            <span className="mt-px block truncate text-[11.5px] text-muted">
                              {item.neighborhood} · {item.rating.toFixed(2)} · {item.reviews} reviews
                            </span>
                          </span>
                          <span className="shrink-0 text-[14px] font-semibold tabular-nums">{money(item.price)}/nt</span>
                          <MemberChoiceStrip
                            choices={joinedChoices}
                            optionId={item.id}
                            kind="stay"
                            onChoose={(choice) => assignPickedStay(choice.member, choice.index, item)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[14px] text-muted">Stays show up after a destination is confirmed.</p>
            )}
          </section>
        </div>

        {allJoinedHaveFlight && allJoinedHaveStay ? (
          <GroupBuy
            destinationId={state.destinationId}
            startDate={state.startDate}
            endDate={state.endDate}
            members={joinedChoices}
            chosenFlight={liveFlight}
            chosenStay={liveStay}
          />
        ) : null}

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

function PersonRow({
  name,
  index,
  title,
  detail,
  detailClassName = "text-muted",
  amount,
  split,
  pending = "Not picked yet",
  trailing,
}: {
  name: string;
  index: number;
  title: string;
  detail: string;
  detailClassName?: string;
  amount?: string;
  split?: string;
  pending?: string | null;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-bg-muted px-3.5 py-3">
      <Avatar name={name} index={index} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{title}</span>
          {trailing}
        </span>
        <span className={cn("mt-px block truncate text-[12px]", detailClassName)}>{detail}</span>
      </span>
      {amount ? (
        <span className="shrink-0 text-right text-[15px] font-bold tabular-nums">
          {amount}
          {split ? <span className="mt-0.5 block text-[11px] font-medium text-ink-faint">{split}</span> : null}
        </span>
      ) : pending ? (
        <span className="shrink-0 text-[12px] font-semibold text-ink-faint">{pending}</span>
      ) : null}
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
        Attaching a link or photo turns your comment into a suggested option the group can weigh in on.
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
  const [expanded, setExpanded] = useState(false);
  const pickedFirst = [...choices].sort((a, b) => {
    const aOn = choiceId(a.member, kind) === optionId ? 0 : 1;
    const bOn = choiceId(b.member, kind) === optionId ? 0 : 1;
    return aOn - bOn || a.index - b.index;
  });
  const overflow = choices.length > 3 && !expanded;
  const visible = overflow ? pickedFirst.slice(0, 2) : choices;
  const hidden = choices.length - 2;

  return (
    <div
      className="inline-flex shrink-0 items-center rounded-full border border-line-soft bg-surface py-0.5 pr-1 pl-0.5"
      aria-label={`Choose ${kind === "flight" ? "flight" : "stay"} by person`}
    >
      {visible.map((choice, position) => {
        const name = memberLabel(choice.member, choice.index);
        const selected = choiceId(choice.member, kind) === optionId;
        return (
          <button
            key={choice.member.id}
            type="button"
            aria-pressed={selected}
            title={`${name}: ${selected ? "picked" : "pick this"}`}
            onClick={() => onChoose(choice)}
            className={cn("relative rounded-full", position > 0 && "-ml-2", selected && "z-10 ring-2 ring-success")}
          >
            <Avatar name={name} index={choice.index} dashed={!selected} />
            <span className="sr-only">
              {selected ? `${name} picked this ${kind}` : `Pick this ${kind} for ${name}`}
            </span>
          </button>
        );
      })}
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="relative -ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#efe3d9] text-[11px] font-bold text-[#8a6a31]"
          aria-label={`Show ${hidden} more people`}
        >
          +{hidden}
        </button>
      ) : null}
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
  dashed = false,
}: {
  name: string;
  index: number;
  size?: "sm" | "md";
  overlap?: boolean;
  dashed?: boolean;
}) {
  const tone = TONES[index % TONES.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11.5px]",
        overlap && "-ml-1.5",
        dashed ? "border border-dashed opacity-70" : "border-2 border-white",
      )}
      style={{ background: tone.bg, color: tone.color, ...(dashed ? { borderColor: tone.color } : {}) }}
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

function offerClock(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)),
  );
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))),
  );
  return `${date} · ${time}`;
}

function stopLabel(stops: number): string {
  if (stops <= 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
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
    id: uniqueId(`flight-${option.id}`),
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
    id: uniqueId(`stay-${option.id}`),
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
