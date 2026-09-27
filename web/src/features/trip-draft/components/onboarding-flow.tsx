"use client";

/**
 * Questionnaire at `/onboarding?entry=questions`. The two-option screen is `entry-choice.tsx`.
 * No `AppShell`. Continue writes `useTrip`; the last step calls `finish()` → `/studio`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DestinationSearch } from "@/features/trip-draft/components/destination-search";
import { BUDGETS, DESTINATIONS, destinationById, type Destination } from "@/features/trip-draft/fixtures";
import { money, QUESTIONNAIRE_KICKOFF_KEY, validRange } from "@/features/trip-draft/format";
import { useTrip, type TripState } from "@/features/trip-draft/trip-context";
import { Chip, PrimaryButton } from "@/features/trip-draft/components/chrome";
import { TripMap } from "@/features/trip-draft/components/trip-map";

const STEPS = [
  {
    id: "where",
    optional: false,
    title: "Where to?",
    tip: "Tip: pick where you're leaving from and where you're going. The agent chooses the airports.",
  },
  {
    id: "when",
    optional: false,
    title: "When are you going?",
    tip: "Tip: a short range gives the agent room to dodge the priciest days.",
  },
  {
    id: "who",
    optional: false,
    title: "Who is going?",
    tip: "Tip: add everyone traveling. The agent searches for that many people.",
  },
  {
    id: "budget",
    optional: false,
    title: "What's the budget per person?",
    tip: "Tip: budgets help the agent avoid pricey outliers.",
  },
  {
    id: "visit",
    optional: true,
    title: "Any place you want to visit?",
    tip: "Tip: name a neighborhood, landmark, or idea. The agent recommends places that match.",
  },
  {
    id: "stay",
    optional: true,
    title: "What kind of place do you want to stay in?",
    tip: "Tip: a sentence is enough, like a quiet ryokan near the station.",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const calendarClass =
  "w-full rounded-2xl border border-line bg-surface p-3 text-ink [--cell-size:2.75rem] [--background:var(--surface)] [--foreground:var(--ink)] [--muted:var(--surface-sunken)] [--muted-foreground:var(--ink-faint)]";

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseIso(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mapPreview(state: TripState): Destination | null {
  const fixture = destinationById(state.destinationId);
  if (fixture) return fixture;
  if (state.destinationLat == null || state.destinationLng == null) return null;
  return {
    id: state.destinationIata ?? "picked",
    label: state.destinationLabel || state.destinationQuery,
    country: "",
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
  const [party, setParty] = useState<string[] | null>(null);

  const step = STEPS[index];
  const destination = destinationById(state.destinationId);
  const preview = mapPreview(state);
  const roundTrip = state.roundTrip !== false;

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

  function datesReady(): boolean {
    return roundTrip ? validRange(state.startDate, state.endDate) : Boolean(state.startDate);
  }

  function partyNames(): string[] {
    if (party) return party;
    const going = state.members.filter((member) => member.joined && !member.placeholder);
    const names = (going.length > 0 ? going : state.members.slice(0, 1)).map((member) => member.name);
    return names.length > 0 ? names : [""];
  }

  function canContinue(id: StepId = step.id): boolean {
    if (id === "where") return Boolean(state.destinationIata && state.originIata);
    if (id === "when") return datesReady();
    if (id === "who") return partyNames().some((name) => name.trim());
    if (id === "budget") return state.budget != null && state.budget > 0;
    return true;
  }

  function finish() {
    if (handingOff) return;
    setHandingOff(true);
    trip.commitDraft();
    sessionStorage.setItem(QUESTIONNAIRE_KICKOFF_KEY, "1");
    window.setTimeout(() => router.push("/studio"), 900);
  }

  function next() {
    if (step.id === "where" && !(state.destinationIata && state.originIata)) {
      if (!state.originIata && !state.destinationIata) {
        setError("Pick a starting place and a destination from the list.");
      } else if (!state.originIata) {
        setError("Pick a starting place from the list.");
      } else {
        setError("Pick a destination from the list, or choose Surprise me.");
      }
      return;
    }
    if (step.id === "when" && !datesReady()) {
      setError(roundTrip ? "Choose an arrival and a later departure." : "Choose a departure date.");
      return;
    }
    if (step.id === "who") {
      const names = partyNames().map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) {
        setError("Add at least one person who's going.");
        return;
      }
      trip.setGoing(names);
      setParty(names);
    }
    if (step.id === "budget" && !(state.budget != null && state.budget > 0)) {
      setError("Set a budget so the agent can skip pricey outliers.");
      return;
    }
    if (index === STEPS.length - 1) {
      finish();
      return;
    }
    go(index + 1);
  }

  function skip() {
    if (!step.optional) return;
    if (step.id === "visit") trip.setPlacesToVisit("");
    if (step.id === "stay") {
      trip.setStayPreference("");
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
                      <div>
                        <p className="mb-2 text-[14px] font-semibold">Starting from</p>
                        <DestinationSearch
                          label="Starting from"
                          placeholder="City or place — try New York"
                          listId="origin-suggestions"
                          value={state.originQuery ?? ""}
                          onQueryChange={trip.setOriginQuery}
                          onSelect={(place) =>
                            trip.confirmOrigin({
                              label: place.name,
                              iataCode: place.iataCode,
                              airportIatas: place.airports.map((airport) => airport.iataCode),
                            })
                          }
                        />
                      </div>
                      <div>
                        <p className="mb-2 text-[14px] font-semibold">Going to</p>
                        <DestinationSearch
                          label="Going to"
                          listId="destination-suggestions"
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
                      </div>
                      {state.pinDropped && (destination || state.destinationIata) ? (
                        <p className="text-[14px] text-ink">
                          {state.destinationLabel || destination?.label}
                          {destination?.country ? `, ${destination.country}` : ""}
                          {" · pinned on the map"}
                        </p>
                      ) : null}
                      <label className="flex w-fit items-center gap-3 text-[15px] font-semibold text-ink">
                        <Checkbox
                          checked={roundTrip}
                          onCheckedChange={(checked) => trip.setRoundTrip(checked)}
                        />
                        Round trip
                      </label>
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

                  {step.id === "when" && roundTrip ? (
                    <Calendar
                      mode="range"
                      className={calendarClass}
                      classNames={{ root: "w-full" }}
                      defaultMonth={parseIso(state.startDate)}
                      selected={{ from: parseIso(state.startDate), to: parseIso(state.endDate) }}
                      onSelect={(range) => {
                        trip.setDates(range?.from ? isoDate(range.from) : "", range?.to ? isoDate(range.to) : "");
                      }}
                    />
                  ) : null}

                  {step.id === "when" && !roundTrip ? (
                    <Calendar
                      mode="single"
                      className={calendarClass}
                      classNames={{ root: "w-full" }}
                      defaultMonth={parseIso(state.startDate)}
                      selected={parseIso(state.startDate)}
                      onSelect={(day) => {
                        trip.setDates(day ? isoDate(day) : "", "");
                      }}
                    />
                  ) : null}

                  {step.id === "who" ? (
                    <div className="flex flex-col gap-3">
                      {partyNames().map((name, personIndex) => (
                        <div key={personIndex} className="flex items-center gap-2">
                          <label className="block min-w-0 flex-1">
                            <span className="sr-only">{personIndex === 0 ? "Your name" : `Person ${personIndex + 1}`}</span>
                            <input
                              value={name}
                              onChange={(event) => {
                                const names = partyNames();
                                setParty(names.map((item, index) => (index === personIndex ? event.target.value : item)));
                              }}
                              placeholder={personIndex === 0 ? "Your name" : "Name"}
                              className="h-14 w-full rounded-xl border border-[#b0b0b0] px-4 outline-none focus:border-ink"
                            />
                          </label>
                          {personIndex > 0 ? (
                            <button
                              type="button"
                              onClick={() => setParty(partyNames().filter((_, index) => index !== personIndex))}
                              className="h-14 shrink-0 px-2 text-[14px] font-semibold text-ink-faint"
                              aria-label={`Remove ${name.trim() || `person ${personIndex + 1}`}`}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {partyNames().length < 6 ? (
                        <button
                          type="button"
                          onClick={() => setParty([...partyNames(), ""])}
                          className="h-12 w-fit rounded-full bg-bg-muted px-6 text-[15px] font-semibold text-ink"
                        >
                          Add a person
                        </button>
                      ) : null}
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

                  {step.id === "visit" ? (
                    <label className="block">
                      <span className="sr-only">Places you want to visit</span>
                      <Textarea
                        value={state.placesToVisit ?? ""}
                        onChange={(event) => trip.setPlacesToVisit(event.target.value)}
                        placeholder="A neighborhood, landmark, or idea"
                        className="min-h-28 rounded-xl border-[#b0b0b0] px-3 py-3 text-[16px]"
                      />
                    </label>
                  ) : null}

                  {step.id === "stay" ? (
                    <label className="block">
                      <span className="sr-only">Kind of place to stay</span>
                      <Textarea
                        value={state.stayPreference ?? ""}
                        onChange={(event) => trip.setStayPreference(event.target.value)}
                        placeholder="A quiet ryokan, a hotel in the center…"
                        className="min-h-28 rounded-xl border-[#b0b0b0] px-3 py-3 text-[16px]"
                      />
                    </label>
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
