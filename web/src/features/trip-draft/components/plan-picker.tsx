"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { destinationById, findFlight, findStay, flightsFor, staysFor, type FlightOption, type StayOption } from "@/features/trip-draft/fixtures";
import { formatRange, money, nightsBetween, stayOverBudget } from "@/features/trip-draft/format";
import { useTrip } from "@/features/trip-draft/trip-context";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { PrimaryButton, ScreenHeader } from "@/features/trip-draft/components/chrome";
import { OptionCard } from "@/features/trip-draft/components/option-card";
import { cn } from "@/lib/utils";

export function PlanPicker() {
  const router = useRouter();
  const { state, lockFlight, lockStay, toggleCompareFlight, toggleCompareStay, setComparingFlights, setComparingStays } =
    useTrip();
  const [notice, setNotice] = useState("");
  const [leaving, setLeaving] = useState(false);

  const destination = destinationById(state.destinationId);
  const flights = flightsFor(state.destinationId);
  const stays = staysFor(state.destinationId);
  const flight = findFlight(state.destinationId, state.lockedFlightId);
  const stay = findStay(state.destinationId, state.lockedStayId);
  const nights = nightsBetween(state.startDate, state.endDate);
  const perPerson = (flight?.price ?? 0) + (stay ? stay.price * nights : 0);
  const people = Math.max(state.members.length, 1);
  const ready = Boolean(flight && stay);

  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function pickFlight(id: string) {
    if (!state.comparingFlights) {
      lockFlight(id);
      setNotice("");
      return;
    }
    if (!state.compareFlightIds.includes(id) && state.compareFlightIds.length >= 3) {
      setNotice("Compare up to 3 flights.");
      return;
    }
    setNotice("");
    toggleCompareFlight(id);
  }

  function pickStay(id: string) {
    if (!state.comparingStays) {
      lockStay(id);
      setNotice("");
      return;
    }
    if (!state.compareStayIds.includes(id) && state.compareStayIds.length >= 3) {
      setNotice("Compare up to 3 stays.");
      return;
    }
    setNotice("");
    toggleCompareStay(id);
  }

  function continueNext() {
    if (!ready || leaving) return;
    setLeaving(true);
    window.setTimeout(() => router.push("/progress"), 700);
  }

  if (!destination) {
    return (
      <AppShell>
        <main className="min-h-full bg-white">
          <ScreenHeader title="Pick a flight and a stay" current="/plan" />
          <div className="mx-auto max-w-xl px-5 py-16">
            <p className="text-[18px] text-ink">Tell the agent where you&rsquo;re going first.</p>
            <Link
              href="/onboarding"
              className="mt-6 inline-flex h-12 items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white"
            >
              Start the questionnaire
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const comparedFlights = state.compareFlightIds
    .map((id) => flights.find((item) => item.id === id))
    .filter((item): item is FlightOption => Boolean(item));
  const comparedStays = state.compareStayIds
    .map((id) => stays.find((item) => item.id === id))
    .filter((item): item is StayOption => Boolean(item));

  return (
    <AppShell>
      <main className="min-h-full bg-white">
        <ScreenHeader
          current="/plan"
          title="Pick a flight and a stay"
          subtitle={`${destination.label} · ${formatRange(state.startDate, state.endDate)}${state.budget ? ` · ${money(state.budget)} / person` : ""}`}
        />
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-5 py-8">
          <p className="min-h-5 text-[14px] text-muted" aria-live="polite">
            {notice || "Tap a card to lock it in, or turn on Compare and choose 2–3."}
          </p>

          <section id="flights" className="scroll-mt-36">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">Flights</h2>
                <p className="text-[14px] text-muted">From JFK · sample fares</p>
              </div>
              <button
                type="button"
                aria-pressed={state.comparingFlights}
                onClick={() => setComparingFlights(!state.comparingFlights)}
                className={cn(
                  "h-11 rounded-full px-4 text-[14px] font-semibold",
                  state.comparingFlights ? "bg-ink text-white" : "bg-bg-muted text-ink",
                )}
              >
                {state.comparingFlights ? "Comparing" : "Compare"}
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {flights.map((item) => (
                <OptionCard
                  key={item.id}
                  image={item.image}
                  title={item.airline}
                  subtitle={`${item.from} → ${item.to} · ${item.stops}`}
                  meta={`${item.depart} – ${item.arrive} · ${item.duration}`}
                  priceLabel={money(item.price)}
                  priceHint="Round trip, per person"
                  selected={state.lockedFlightId === item.id}
                  compared={state.comparingFlights && state.compareFlightIds.includes(item.id)}
                  compareIndex={
                    state.compareFlightIds.includes(item.id) ? state.compareFlightIds.indexOf(item.id) + 1 : null
                  }
                  overBudget={state.budget != null && item.price > state.budget}
                  onSelect={() => pickFlight(item.id)}
                />
              ))}
            </div>
            <CompareTray
              active={state.comparingFlights}
              count={comparedFlights.length}
              noun="flights"
              items={comparedFlights.map((item) => ({
                id: item.id,
                image: item.image,
                title: item.airline,
                detail: `${item.depart} – ${item.arrive} · ${item.stops}`,
                price: money(item.price),
              }))}
              onLock={lockFlight}
            />
          </section>

          <section id="stays" className="scroll-mt-36">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">Stays</h2>
                <p className="text-[14px] text-muted">{destination.label} · {nights} {nights === 1 ? "night" : "nights"}</p>
              </div>
              <button
                type="button"
                aria-pressed={state.comparingStays}
                onClick={() => setComparingStays(!state.comparingStays)}
                className={cn(
                  "h-11 rounded-full px-4 text-[14px] font-semibold",
                  state.comparingStays ? "bg-ink text-white" : "bg-bg-muted text-ink",
                )}
              >
                {state.comparingStays ? "Comparing" : "Compare"}
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {stays.map((item) => (
                <OptionCard
                  key={item.id}
                  image={item.image}
                  title={item.name}
                  subtitle={`${item.neighborhood} · Entire place`}
                  meta={`★ ${item.rating.toFixed(2)} · ${item.reviews} reviews`}
                  priceLabel={money(item.price)}
                  priceHint="Per night"
                  selected={state.lockedStayId === item.id}
                  compared={state.comparingStays && state.compareStayIds.includes(item.id)}
                  compareIndex={state.compareStayIds.includes(item.id) ? state.compareStayIds.indexOf(item.id) + 1 : null}
                  overBudget={stayOverBudget(item.price, nights, state.budget)}
                  onSelect={() => pickStay(item.id)}
                />
              ))}
            </div>
            <CompareTray
              active={state.comparingStays}
              count={comparedStays.length}
              noun="stays"
              items={comparedStays.map((item) => ({
                id: item.id,
                image: item.image,
                title: item.name,
                detail: `${item.neighborhood} · ★ ${item.rating.toFixed(2)}`,
                price: `${money(item.price)} / night`,
              }))}
              onLock={lockStay}
            />
          </section>
        </div>

        <div className="sticky bottom-0 z-30 border-t border-line-soft bg-white/95 px-5 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Trip total</p>
              <p className="text-[20px] font-semibold">{flight || stay ? money(perPerson) : "—"}</p>
              <p className="text-[13px] text-muted">
                {flight || stay ? `${money(perPerson * people)} for ${people}` : "Lock in a flight and a stay"}
              </p>
            </div>
            <PrimaryButton type="button" disabled={!ready || leaving} onClick={continueNext}>
              Continue
            </PrimaryButton>
          </div>
        </div>

        {leaving ? (
          <div className="rise fixed inset-0 z-40 flex items-center justify-center bg-white">
            <h2 className="text-[28px] font-semibold tracking-tight">Locking those in…</h2>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}

function CompareTray({
  active,
  count,
  noun,
  items,
  onLock,
}: {
  active: boolean;
  count: number;
  noun: string;
  items: { id: string; image: string; title: string; detail: string; price: string }[];
  onLock: (id: string) => void;
}) {
  if (!active) return null;
  if (count < 2) {
    const hint = count === 0 ? `Select 2 or 3 ${noun} to compare side by side.` : `Select one more to compare side by side.`;
    return <p className="mt-4 text-[14px] text-muted">{hint}</p>;
  }
  return (
    <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
      {items.map((item) => (
        <article
          key={item.id}
          className="flex w-[78%] shrink-0 flex-col gap-3 rounded-[20px] border border-line-soft bg-bg-muted p-3 shadow-[var(--shadow)] sm:w-[46%] lg:w-auto lg:min-w-0 lg:flex-1"
        >
          <div className="relative h-20 w-full">
            <Image src={item.image} alt="" fill sizes="280px" className="rounded-2xl object-cover" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold">{item.title}</h3>
            <p className="text-[14px] text-muted">{item.detail}</p>
            <p className="mt-1 text-[16px] font-semibold">{item.price}</p>
          </div>
          <button
            type="button"
            onClick={() => onLock(item.id)}
            className="h-11 rounded-full bg-ink text-[14px] font-semibold text-white"
          >
            Lock it in
          </button>
        </article>
      ))}
    </div>
  );
}
