"use client";

/**
 * Questionnaire at `/onboarding?entry=questions`. The two-option screen is `entry-choice.tsx`.
 * No `AppShell`. Continue writes `useTrip`; the last step and Skip on "who" call `finish()` → `/studio`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DestinationSearch } from "@/features/trip-draft/components/destination-search";
import { BUDGETS, DESTINATIONS, DIETARY, VIBES, destinationById, type Destination } from "@/features/trip-draft/fixtures";
import { money, validRange } from "@/features/trip-draft/format";
import { useTrip, type TripState } from "@/features/trip-draft/trip-context";
import { Chip, PrimaryButton } from "@/features/trip-draft/components/chrome";
import { TripMap } from "@/features/trip-draft/components/trip-map";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    id: "where",
    optional: false,
    title: "Where to?",
    tip: "Tip: a city name lets the map settle before the agent looks for flights.",
  },
  {
    id: "when",
    optional: false,
    title: "When are you going?",
    tip: "Tip: a short range gives the agent room to dodge the priciest days.",
  },
  {
    id: "budget",
    optional: false,
    title: "What's the budget per person?",
    tip: "Tip: budgets help the agent avoid pricey outliers.",
  },
  {
    id: "dietary",
    optional: true,
    title: "Any dietary restrictions?",
    tip: "Tip: the agent keeps restaurants that work for the whole group.",
  },
  {
    id: "vibe",
    optional: true,
    title: "What's the vibe?",
    tip: "Tip: a few interests beat a long list. The agent plans around them.",
  },
  {
    id: "who",
    optional: true,
    title: "Who's coming?",
    tip: "Tip: add a placeholder for anyone who hasn't joined. They'll get the invite link.",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function mapPreview(state: TripState): Destination | null {
  const fixture = destinationById(state.destinationId);
  if (fixture) return fixture;
  if (state.destinationLat == null || state.destinationLng == null) return null;
  return {
    id: state.destinationIata ?? "picked",
    label: state.destinationLabel || state.destinationQuery,
    country: state.destinationIata ?? "",
    code: state.destinationIata ?? "",
    lat: state.destinationLat,
    lng: state.destinationLng,
    blurb: "",
    photos: ["", "", ""],
  };
}

export function OnboardingFlow() {
  const router = useRouter();
  const trip = useTrip();
  const { state } = trip;
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [visible, setVisible] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [error, setError] = useState("");

  const step = STEPS[index];
  const destination = destinationById(state.destinationId);
  const preview = mapPreview(state);

  function go(next: number) {
    if (next === index || handingOff) return;
    setDirection(next > index ? 1 : -1);
    setVisible(false);
    setError("");
    window.setTimeout(() => {
      setIndex(next);
      setVisible(true);
    }, 180);
  }

  function canContinue(id: StepId = step.id): boolean {
    if (id === "where") return Boolean(state.destinationIata);
    if (id === "when") return validRange(state.startDate, state.endDate);
    if (id === "budget") return state.budget != null && state.budget > 0;
    if (id === "who") return state.members[0]?.name.trim().length > 0;
    return true;
  }

  function finish() {
    if (handingOff) return;
    setHandingOff(true);
    trip.commitDraft();
    window.setTimeout(() => router.push("/studio"), 900);
  }

  function next() {
    if (step.id === "where") {
      if (!state.destinationIata) {
        setError("Pick a city or airport from the list, or choose Surprise me.");
        return;
      }
    }
    if (step.id === "when" && !validRange(state.startDate, state.endDate)) {
      setError("Choose an arrival and a later departure.");
      return;
    }
    if (step.id === "budget" && !(state.budget != null && state.budget > 0)) {
      setError("Set a budget so the agent can skip pricey outliers.");
      return;
    }
    if (index === STEPS.length - 1) {
      if (!canContinue("who")) {
        setError("Add your name, or skip to keep Person 1.");
        return;
      }
      finish();
      return;
    }
    go(index + 1);
  }

  function skip() {
    if (!step.optional) return;
    if (step.id === "dietary") trip.setDietary([]);
    if (step.id === "vibe") trip.setVibes([]);
    if (step.id === "who") {
      trip.resetParty();
      finish();
      return;
    }
    go(index + 1);
  }

  function surprise() {
    if (rolling) return;
    setRolling(true);
    setError("");
    window.setTimeout(() => {
      const pick = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
      trip.confirmDestination(pick.id);
      setRolling(false);
    }, 700);
  }

  return (
    <div className="grid min-h-dvh grid-rows-[minmax(0,1fr)_240px] lg:grid-cols-[minmax(420px,540px)_minmax(0,1fr)] lg:grid-rows-1">
      <section className="flex min-h-0 flex-col px-5 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0 || handingOff}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[20px] text-ink disabled:opacity-30"
            aria-label="Back"
          >
            ←
          </button>
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={index + 1}
            aria-label="Questionnaire progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          {step.optional ? (
            <button type="button" onClick={skip} className="h-11 px-2 text-[15px] font-semibold text-ink underline">
              Skip
            </button>
          ) : (
            <span className="w-11" />
          )}
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            next();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto py-6">
            {visible ? (
              <div key={step.id} className={direction > 0 ? "step-forward" : "step-back"}>
                <p className="text-[13px] font-semibold text-muted">
                  Question {index + 1} of {STEPS.length}
                </p>
                <h1 className="font-display mt-2 text-[2.15rem] leading-[1.08] font-medium tracking-[-0.03em] text-balance">{step.title}</h1>
                <div className="mt-6">
                  {step.id === "where" ? (
                    <div className="flex flex-col gap-4">
                      <DestinationSearch
                        value={state.destinationQuery}
                        onQueryChange={trip.setDestinationQuery}
                        onSelect={(place) =>
                          trip.confirmPlace({
                            label: place.name,
                            iataCode: place.iataCode,
                            airportIatas: place.airports.map((airport) => airport.iataCode),
                            lat: place.lat,
                            lng: place.lng,
                          })
                        }
                      />
                      {state.pinDropped && (destination || state.destinationIata) ? (
                        <p className="text-[14px] text-ink">
                          {state.destinationLabel || destination?.label}
                          {destination?.country ? `, ${destination.country}` : state.destinationIata ? ` · ${state.destinationIata}` : ""}
                          {" · pinned on the map"}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={surprise}
                        disabled={rolling}
                        className="h-12 w-full rounded-full bg-bg-muted text-[15px] font-semibold text-ink disabled:opacity-60 sm:w-fit sm:px-6"
                      >
                        {rolling ? "Picking a city…" : "Surprise me"}
                      </button>
                    </div>
                  ) : null}

                  {step.id === "when" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-[14px] font-semibold">
                        Arrive
                        <input
                          type="date"
                          value={state.startDate}
                          onChange={(event) => trip.setDates(event.target.value, state.endDate)}
                          className="mt-2 h-14 w-full rounded-xl border border-[#b0b0b0] px-3 font-normal outline-none focus:border-ink"
                        />
                      </label>
                      <label className="block text-[14px] font-semibold">
                        Leave
                        <input
                          type="date"
                          value={state.endDate}
                          min={state.startDate || undefined}
                          onChange={(event) => trip.setDates(state.startDate, event.target.value)}
                          className="mt-2 h-14 w-full rounded-xl border border-[#b0b0b0] px-3 font-normal outline-none focus:border-ink"
                        />
                      </label>
                    </div>
                  ) : null}

                  {step.id === "budget" ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap gap-2">
                        {BUDGETS.map((amount) => (
                          <Chip
                            key={amount}
                            pressed={state.budget === amount}
                            onClick={() => trip.setBudget(amount)}
                          >
                            {money(amount)}
                          </Chip>
                        ))}
                      </div>
                      <label className="relative block max-w-xs">
                        <span className="sr-only">Custom budget per person</span>
                        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[16px]">$</span>
                        <input
                          inputMode="numeric"
                          value={state.budget ?? ""}
                          onChange={(event) => {
                            const digits = event.target.value.replace(/[^\d]/g, "");
                            trip.setBudget(digits ? Number(digits) : null);
                          }}
                          placeholder="Custom"
                          className="h-14 w-full rounded-xl border border-[#b0b0b0] pr-4 pl-8 outline-none focus:border-ink"
                        />
                      </label>
                    </div>
                  ) : null}

                  {step.id === "dietary" ? (
                    <div className="flex flex-wrap gap-2">
                      {DIETARY.map((item) => (
                        <Chip
                          key={item}
                          pressed={state.dietary.includes(item)}
                          onClick={() => trip.toggleDietary(item)}
                        >
                          {item}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  {step.id === "vibe" ? (
                    <div className="flex flex-wrap gap-2">
                      {VIBES.map((item) => (
                        <Chip key={item} pressed={state.vibes.includes(item)} onClick={() => trip.toggleVibe(item)}>
                          {item}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  {step.id === "who" ? (
                    <div className="flex flex-col gap-3">
                      {state.members.map((member, memberIndex) => (
                        <div key={member.id} className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                              member.joined && !member.placeholder
                                ? "bg-ink text-white"
                                : "border border-dashed border-[#b0b0b0] text-muted",
                            )}
                            aria-hidden
                          >
                            {member.placeholder ? "?" : memberIndex + 1}
                          </span>
                          <label className="min-w-0 flex-1">
                            <span className="sr-only">{memberIndex === 0 ? "Your name" : `Person ${memberIndex + 1}`}</span>
                            <input
                              value={member.name}
                              onChange={(event) => trip.setMemberName(member.id, event.target.value)}
                              placeholder={member.placeholder ? "Hasn't joined yet" : "Name"}
                              className="h-12 w-full rounded-xl border border-[#b0b0b0] px-3 outline-none focus:border-ink"
                            />
                          </label>
                          {memberIndex > 0 ? (
                            <button
                              type="button"
                              onClick={() => trip.removeMember(member.id)}
                              className="h-11 px-2 text-[14px] font-semibold text-muted"
                            >
                              Remove
                            </button>
                          ) : (
                            <span className="px-2 text-[13px] font-medium text-muted">You</span>
                          )}
                        </div>
                      ))}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => trip.addMember(false)}
                          className="h-11 rounded-full bg-bg-muted px-4 text-[14px] font-semibold"
                        >
                          Add someone
                        </button>
                        <button
                          type="button"
                          onClick={() => trip.addMember(true)}
                          className="h-11 rounded-full bg-bg-muted px-4 text-[14px] font-semibold"
                        >
                          Add a placeholder
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <aside className="mt-6 rounded-2xl bg-tip px-4 py-3 text-[14px] text-ink ring-1 ring-[var(--tip-line)]">
                  {step.tip}
                </aside>
                {error ? (
                  <p className="mt-3 text-[14px] font-medium text-accent" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="h-40" />
            )}
          </div>
          <div className="flex justify-end pt-3">
            <PrimaryButton type="submit" disabled={handingOff || !canContinue()} className="min-w-36">
              {index === STEPS.length - 1 ? "Let's plan!" : "Continue"}
            </PrimaryButton>
          </div>
        </form>
      </section>

      <aside className="min-h-[240px] border-t border-line-soft lg:border-t-0 lg:border-l">
        <TripMap focus={preview} pinned={Boolean(state.pinDropped && (destination || state.destinationIata))} />
      </aside>

      {handingOff ? (
        <div className="rise fixed inset-0 z-40 flex items-center justify-center bg-white px-6">
          <div className="max-w-sm text-center">
            <p className="text-[13px] font-semibold text-muted">Group Trip Agent</p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight">
              Opening the map{destination?.label || state.destinationLabel ? ` for ${destination?.label || state.destinationLabel}` : ""}…
            </h2>
          </div>
        </div>
      ) : null}
    </div>
  );
}
