"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { ScreenHeader } from "@/features/trip-draft/components/chrome";
import { destinationById, findFlight, findStay } from "@/features/trip-draft/fixtures";
import { formatRange, initials, money, nightsBetween } from "@/features/trip-draft/format";
import { useTrip } from "@/features/trip-draft/trip-context";
import type { Member } from "@/features/trip-draft/trip-context";
import { cn } from "@/lib/utils";

const VIBE_STOPS: Record<string, { title: string; detail: string }> = {
  Food: {
    title: "Market lunch",
    detail: "A long table near the stay, filtered for the group's dietary notes.",
  },
  Nightlife: {
    title: "Evening out",
    detail: "A short walk from the stay, so nobody has to plan the ride home.",
  },
  Museums: {
    title: "One museum, unhurried",
    detail: "Morning entry, then a slow hour nearby.",
  },
  Outdoors: {
    title: "A long walk",
    detail: "Out before it gets hot, back before dinner.",
  },
  Beach: {
    title: "Water, then shade",
    detail: "Late morning. The afternoon stays open.",
  },
  Design: {
    title: "A design stop",
    detail: "One building or studio, not a checklist.",
  },
  "Slow mornings": {
    title: "Nothing before 10",
    detail: "Coffee near the stay. The day starts when it starts.",
  },
};

function memberLabel(member: Member | undefined, fallbackIndex: number): string {
  return member?.name.trim() || `Person ${fallbackIndex + 1}`;
}

function PersonTabs({ members, selectedId, onSelect }: { members: Member[]; selectedId: string; onSelect: (id: string) => void }) {
  if (members.length <= 1) return null;
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Choose traveler itinerary">
      {members.map((member, index) => {
        const selected = member.id === selectedId;
        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(member.id)}
            className={cn(
              "h-10 shrink-0 rounded-full px-4 text-[13px] font-semibold",
              selected ? "bg-ink text-white" : "bg-bg-muted text-ink",
            )}
          >
            {memberLabel(member, index)}
          </button>
        );
      })}
    </div>
  );
}

export function ItineraryView() {
  const { state } = useTrip();
  const destination = destinationById(state.destinationId);
  const nights = nightsBetween(state.startDate, state.endDate);
  const joined = state.members.filter((member) => member.joined);
  const [selectedMemberId, setSelectedMemberId] = useState(() => joined[0]?.id ?? state.members[0]?.id ?? "");
  const selectedMember = joined.find((member) => member.id === selectedMemberId) ?? joined[0] ?? state.members[0];
  const flight = findFlight(state.destinationId, selectedMember?.flightId ?? state.lockedFlightId);
  const stay = findStay(state.destinationId, selectedMember?.stayId ?? state.lockedStayId);
  const totalForPickedPeople = joined.reduce((total, member) => {
    const memberFlight = findFlight(state.destinationId, member.flightId ?? null);
    const memberStay = findStay(state.destinationId, member.stayId ?? null);
    return memberFlight && memberStay ? total + memberFlight.price + memberStay.price * nights : total;
  }, 0);
  const dietary = state.dietary.filter((item) => item !== "None");

  if (!destination) {
    return (
      <AppShell>
        <main className="min-h-full bg-white">
          <ScreenHeader title="Your itinerary" current="/itinerary" />
          <div className="mx-auto max-w-xl px-5 py-16">
            <p className="text-[18px]">Lock in a flight and a stay, then the day plan shows up here.</p>
            <Link
              href={destination ? "/plan" : "/onboarding"}
              className="mt-6 inline-flex h-12 items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:scale-[0.98]"
            >
              {destination ? "Choose flights and stays" : "Start the questionnaire"}
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  if (!flight || !stay) {
    return (
      <AppShell>
        <main className="min-h-full bg-white pb-16">
          <ScreenHeader current="/itinerary" title={`${memberLabel(selectedMember, 0)}'s plan`} subtitle={`${destination.label} · ${formatRange(state.startDate, state.endDate)}`} />
          <div className="mx-auto max-w-3xl px-5 py-6">
            <PersonTabs members={joined} selectedId={selectedMember?.id ?? ""} onSelect={setSelectedMemberId} />
            <div className="mt-6 rounded-[24px] border border-line bg-bg-muted p-6">
              <p className="text-[18px] font-semibold">This traveler needs both a flight and a stay.</p>
              <p className="mt-2 text-[15px] text-muted">Pick options from the current trip summary, then their day plan shows up here.</p>
              <Link href="/current" className="mt-6 inline-flex h-12 items-center rounded-full bg-ink px-6 text-[15px] font-semibold text-white">
                Back to summary
              </Link>
            </div>
          </div>
        </main>
      </AppShell>
    );
  }

  const perPerson = flight.price + stay.price * nights;
  const stops = [
    {
      time: flight.depart,
      title: `Fly ${flight.airline}`,
      detail: `${flight.from} → ${flight.to} · ${flight.stops} · lands ${flight.arrive}`,
    },
    {
      time: "Check-in",
      title: stay.name,
      detail: `${stay.neighborhood} · ${money(stay.price)} / night · ${nights} ${nights === 1 ? "night" : "nights"}`,
    },
    ...state.vibes.slice(0, 3).flatMap((vibe) => {
      const stop = VIBE_STOPS[vibe];
      return stop ? [{ time: vibe, title: stop.title, detail: stop.detail }] : [];
    }),
    {
      time: "Last evening",
      title: "Dinner together",
      detail: dietary.length > 0 ? `The table works for ${dietary.join(", ").toLowerCase()}.` : "No dietary notes on this trip.",
    },
  ];

  return (
    <AppShell>
      <main className="min-h-full bg-white pb-16">
        <ScreenHeader
          current="/itinerary"
          title={`${memberLabel(selectedMember, 0)}'s plan`}
          subtitle={`${destination.label} · ${formatRange(state.startDate, state.endDate)}`}
        />
        <div className="mx-auto max-w-3xl px-5 py-6">
          <PersonTabs members={joined} selectedId={selectedMember?.id ?? ""} onSelect={setSelectedMemberId} />
          <div className="overflow-hidden rounded-[24px] shadow-[var(--shadow)]">
            <div className="relative aspect-[16/9]">
              <Image src={destination.photos[0]} alt="" fill priority sizes="(min-width: 768px) 720px, 100vw" className="object-cover" />
            </div>
            <div className="bg-white px-5 py-5">
              <p className="text-[13px] font-semibold text-muted">{destination.country}</p>
              <h2 className="mt-1 text-[28px] font-semibold tracking-tight">{destination.label}</h2>
              <p className="mt-1 text-[15px] text-muted">{destination.blurb}</p>
              <div className="mt-4 flex items-center gap-2">
                {state.members.map((member) => (
                  <span
                    key={member.id}
                    title={member.joined ? member.name : "Pending"}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-semibold",
                      member.joined ? "bg-ink text-white" : "border border-dashed border-[#b0b0b0] text-muted",
                    )}
                  >
                    {member.joined ? initials(member.name) : "?"}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-[16px] font-semibold">
                {money(perPerson)} for {memberLabel(selectedMember, 0)} · {money(totalForPickedPeople)} assigned total
              </p>
            </div>
          </div>

          <ol className="mt-8">
            {stops.map((stop, index) => (
              <li key={`${stop.title}-${index}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <p className="pt-4 text-[13px] font-semibold text-muted">{stop.time}</p>
                <div className={cn("border-l border-line py-4 pl-4", index === stops.length - 1 && "border-transparent")}>
                  <h3 className="text-[18px] font-semibold">{stop.title}</h3>
                  <p className="mt-1 text-[15px] text-muted">{stop.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/plan" className="inline-flex h-12 items-center rounded-full bg-bg-muted px-5 text-[15px] font-semibold">
              Edit picks
            </Link>
            <Link href="/progress" className="inline-flex h-12 items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-white">
              Back to progress
            </Link>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
