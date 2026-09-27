"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  flightExceedsBudget,
  relevantOffers,
  rememberedFlightOrigin,
  stayExceedsBudget,
} from "@/features/trip-draft/browse-offers";
import { destinationById } from "@/features/trip-draft/fixtures";
import { formatMoney, formatRange, money, nightsBetween } from "@/features/trip-draft/format";
import { flightOfferId } from "@/features/trip-draft/chosen-travel";
import type { FlightOffer } from "@/lib/providers/flights/types";
import type { StayCard } from "@/lib/providers/stays/types";
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
  const [flights, setFlights] = useState<FlightOffer[]>([]);
  const [stays, setStays] = useState<StayCard[]>([]);
  const [flightMessage, setFlightMessage] = useState("");
  const [stayMessage, setStayMessage] = useState("");
  const [flightQuery, setFlightQuery] = useState("");
  const [stayQuery, setStayQuery] = useState("");

  const destination = destinationById(state.destinationId);
  const nights = nightsBetween(state.startDate, state.endDate);
  const adults = Math.max(1, state.members.filter((member) => member.joined).length);
  const datesReady = Boolean(state.startDate && state.endDate && state.endDate > state.startDate);
  const destinationName = (state.destinationLabel || destination?.label || "").trim();
  const destinationIata = (state.destinationIata || destination?.code || "").trim();
  const place =
    state.destinationLat != null && state.destinationLng != null
      ? { lat: state.destinationLat, lng: state.destinationLng }
      : destination
        ? { lat: destination.lat, lng: destination.lng }
        : null;
  const stayPlace = destinationName || destinationIata;
  const flightDestination = (state.destinationIata || destination?.code || state.destinationLabel || destination?.label || "").trim();
  const flightOrigin = state.originLabel?.trim() || rememberedFlightOrigin();
  const stayBlocked = (!place && !stayPlace) || !datesReady;
  const stayBlockedMessage = !place && !stayPlace ? "Pick a destination first." : "Add trip dates to browse stays.";
  const stayKey = stayBlocked
    ? ""
    : [destinationName, destinationIata, place?.lat, place?.lng, state.startDate, state.endDate, adults, state.budget, nights].join("|");
  const flightBlocked =
    !flightDestination || !flightOrigin || !state.startDate || (state.roundTrip !== false && !datesReady);
  const flightBlockedMessage = !flightDestination
    ? "Pick a destination first."
    : !flightOrigin
      ? "Tell the agent where you're flying from."
      : "Add trip dates to browse flights.";
  const flightKey = flightBlocked
    ? ""
    : [flightOrigin, flightDestination, state.startDate, state.endDate, state.roundTrip, adults, state.budget].join("|");

  useEffect(() => {
    if (!stayKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      label: destinationName || stayPlace,
      checkIn: state.startDate,
      checkOut: state.endDate,
      adults: String(adults),
    });
    if (place) {
      params.set("lat", String(place.lat));
      params.set("lng", String(place.lng));
    } else {
      params.set("place", destinationName || destinationIata);
      if (destinationIata) params.set("iata", destinationIata);
    }
    const key = stayKey;
    fetch(`/api/stays/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as { stays?: StayCard[] };
        const ranked = relevantOffers(
          body.stays ?? [],
          (card) => stayExceedsBudget(card, nights, state.budget),
          (card) => card.nightlyAmount ?? Number.POSITIVE_INFINITY,
        );
        setStays(ranked.items);
        setStayMessage(
          ranked.items.length === 0
            ? "No stays in this area for those dates."
            : ranked.relaxed
              ? "Nothing fit the budget. Showing the closest prices."
              : "",
        );
        setStayQuery(key);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStays([]);
        setStayMessage("Stays are unavailable right now.");
        setStayQuery(key);
      });
    return () => controller.abort();
  }, [adults, destinationIata, destinationName, nights, stayKey, stayPlace, state.budget, state.endDate, state.startDate]);

  useEffect(() => {
    if (!flightKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      origin: flightOrigin,
      destination: flightDestination,
      departureDate: state.startDate,
      travelers: String(adults),
    });
    if (state.roundTrip !== false && state.endDate) params.set("returnDate", state.endDate);
    const key = flightKey;
    fetch(`/api/flights/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { flights?: FlightOffer[]; note?: string; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "search failed");
        const ranked = relevantOffers(
          body.flights ?? [],
          (flight) => flightExceedsBudget(flight, state.budget),
          (flight) => flight.price,
        );
        setFlights(ranked.items);
        setFlightMessage(
          ranked.items.length === 0
            ? body.note || "No flights matched that search."
            : ranked.relaxed
              ? "Nothing fit the budget. Showing the closest fares."
              : body.note || "",
        );
        setFlightQuery(key);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setFlights([]);
        setFlightMessage(error instanceof Error && error.message !== "search failed" ? error.message : "Flights are unavailable right now.");
        setFlightQuery(key);
      });
    return () => controller.abort();
  }, [adults, flightDestination, flightKey, flightOrigin, state.budget, state.endDate, state.roundTrip, state.startDate]);

  const visibleStays = stayKey && stayQuery === stayKey ? stays : [];
  const visibleStayMessage = stayBlocked ? stayBlockedMessage : stayQuery === stayKey ? stayMessage : "Looking up stays…";
  const visibleFlights = flightKey && flightQuery === flightKey ? flights : [];
  const visibleFlightMessage = flightBlocked
    ? flightBlockedMessage
    : flightQuery === flightKey
      ? flightMessage
      : "Looking up flights…";

  const flight = visibleFlights.find((item) => flightOfferId(item) === state.lockedFlightId) ?? null;
  const stay = visibleStays.find((item) => item.id === state.lockedStayId) ?? null;
  const perPerson = (flight?.price ?? 0) + (stay?.nightlyAmount != null ? stay.nightlyAmount * nights : 0);
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

  const heading = destination?.label || state.destinationLabel?.trim() || "";
  const cardImage =
    destination?.photos[0] ??
    "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1600&q=80";

  if (!heading) {
    return (
      <AppShell>
        <main className="min-h-full bg-white">
          <ScreenHeader title="Pick a flight and a stay" current="/plan" />
          <div className="mx-auto max-w-xl px-5 py-16">
            <p className="text-[18px] text-ink">Tell the agent where you&rsquo;re going first.</p>
            <Link
              href="/onboarding"
              className="mt-6 inline-flex h-12 items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:scale-[0.98]"
            >
              Start the questionnaire
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const comparedFlights = state.compareFlightIds
    .map((id) => visibleFlights.find((item) => flightOfferId(item) === id))
    .filter((item): item is FlightOffer => Boolean(item));
  const comparedStays = state.compareStayIds
    .map((id) => visibleStays.find((item) => item.id === id))
    .filter((item): item is StayCard => Boolean(item));

  return (
    <AppShell>
      <main className="min-h-full bg-white">
        <ScreenHeader
          current="/plan"
          title="Pick a flight and a stay"
          subtitle={`${heading} · ${formatRange(state.startDate, state.endDate)}${state.budget ? ` · ${money(state.budget)} / person` : ""}`}
        />
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-5 py-8">
          <p className="min-h-5 text-[14px] text-muted" aria-live="polite">
            {notice || "Tap a card to lock it in, or turn on Compare and choose 2–3."}
          </p>

          <section id="flights" className="scroll-mt-36">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">Flights</h2>
                <p className="text-[14px] text-muted">
                  {flightOrigin ? `From ${flightOrigin}` : "Departure city not set"}
                  {visibleFlightMessage ? ` · ${visibleFlightMessage}` : ""}
                </p>
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
            {visibleFlights.length === 0 ? <p className="text-[15px] text-muted">{visibleFlightMessage}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleFlights.map((item) => {
                const id = flightOfferId(item);
                const stops = item.stops === 0 ? "Nonstop" : `${item.stops} stop${item.stops === 1 ? "" : "s"}`;
                return (
                  <OptionCard
                    key={id}
                    image={cardImage}
                    title={item.airline}
                    subtitle={`${item.origin} → ${item.destination} · ${stops}`}
                    meta={`${clock(item.departureTime)} – ${clock(item.arrivalTime)}${item.duration ? ` · ${item.duration}` : ""}`}
                    priceLabel={formatMoney(item.price, item.currency)}
                    priceHint="Per person"
                    selected={state.lockedFlightId === id}
                    compared={state.comparingFlights && state.compareFlightIds.includes(id)}
                    compareIndex={state.compareFlightIds.includes(id) ? state.compareFlightIds.indexOf(id) + 1 : null}
                    overBudget={flightExceedsBudget(item, state.budget)}
                    onSelect={() => pickFlight(id)}
                  />
                );
              })}
            </div>
            <CompareTray
              active={state.comparingFlights}
              count={comparedFlights.length}
              noun="flights"
              items={comparedFlights.map((item) => ({
                id: flightOfferId(item),
                image: cardImage,
                title: item.airline,
                detail: `${clock(item.departureTime)} – ${clock(item.arrivalTime)}`,
                price: formatMoney(item.price, item.currency),
              }))}
              onLock={lockFlight}
            />
          </section>

          <section id="stays" className="scroll-mt-36">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">Stays</h2>
                <p className="text-[14px] text-muted">
                  {heading} · {nights} {nights === 1 ? "night" : "nights"}
                  {visibleStayMessage ? ` · ${visibleStayMessage}` : ""}
                </p>
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
            {visibleStays.length === 0 ? <p className="text-[15px] text-muted">{visibleStayMessage}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleStays.map((item) => (
                <OptionCard
                  key={item.id}
                  image={item.image?.startsWith("https://images.unsplash.com/") ? item.image : cardImage}
                  title={item.name}
                  subtitle={item.area || heading}
                  meta={item.guestScore != null ? `Guest score ${item.guestScore}` : "Sample stay"}
                  priceLabel={item.nightlyAmount != null && item.currency ? formatMoney(item.nightlyAmount, item.currency) : "Price unavailable"}
                  priceHint="Per night"
                  selected={state.lockedStayId === item.id}
                  compared={state.comparingStays && state.compareStayIds.includes(item.id)}
                  compareIndex={state.compareStayIds.includes(item.id) ? state.compareStayIds.indexOf(item.id) + 1 : null}
                  overBudget={stayExceedsBudget(item, nights, state.budget)}
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
                image: cardImage,
                title: item.name,
                detail: item.area || heading,
                price: item.nightlyAmount != null && item.currency ? `${formatMoney(item.nightlyAmount, item.currency)} / night` : "Price unavailable",
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

function clock(value: string): string {
  return /T(\d{2}:\d{2})/.exec(value)?.[1] ?? value;
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
