"use client";

/**
 * Home dashboard: banner, the trip in progress, quick actions, and past trips.
 * "Continue" and "Start a new trip" leave this screen for the studio or the questionnaire.
 */
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Calendar, CirclePlus, MapPin, PenLine, TrendingUp, Users } from "lucide-react";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { TripPeople } from "@/features/trip-draft/components/trip-people";
import {
  PAST_TRIPS,
  greetingFor,
  inProgressCard,
  organizerProfile,
} from "@/features/trip-draft/dashboard-data";
import { useTrip } from "@/features/trip-draft/trip-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { initials } from "@/features/trip-draft/format";

export function DashboardHome() {
  const trip = useTrip();
  const card = inProgressCard(trip.state);
  const profile = organizerProfile(trip.state);
  const [copied, setCopied] = useState(false);
  const joined = trip.state.members.filter((member) => member.joined);

  async function copyInvite() {
    const url = `${window.location.origin}/`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trip.markInviteShared();
    } catch {
      setCopied(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1080px] px-6 py-9 sm:px-10">
        <div className="relative mb-7 flex min-h-[220px] items-end overflow-hidden rounded-[20px] shadow-[var(--shadow)]">
          <Image
            src="https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1600&q=80"
            alt="A yellow tram on a steep city street"
            fill
            priority
            sizes="(min-width: 1080px) 1080px, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-black/25" />
          <div className="relative z-10 px-7 py-6 text-white">
            <p className="mb-1.5 text-[13px] font-semibold text-white/90">{greetingFor(profile.greeting)}</p>
            <h1 className="max-w-[520px] text-[26px] leading-tight font-extrabold tracking-tight">
              Plan the trip before everyone&rsquo;s in the chat.
            </h1>
            <p className="mt-2 max-w-[460px] text-[14px] leading-normal text-[#ede6d9]">
              A few questions, a flight, a stay, then a link for the people who haven&rsquo;t joined.
            </p>
          </div>
        </div>

        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">Continue planning</h2>
          <Link href="/trips" className="text-[13px] font-semibold text-muted hover:text-accent">
            View all trips
          </Link>
        </div>

        <Link href={trip.state.destinationId ? "/current" : "/studio"} className="mb-8 block">
          <Card className="flex flex-col gap-5 rounded-[20px] p-5 shadow-[var(--shadow)] ring-line transition hover:-translate-y-0.5 sm:flex-row sm:p-[22px]">
            <span className="relative h-[110px] w-full shrink-0 overflow-hidden rounded-[10px] sm:w-[150px]">
              <Image src={card.image} alt="" fill sizes="150px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[17px] font-bold text-ink">{card.title}</span>
                  <span className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] font-normal text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3.5 opacity-70" />
                      {card.datesLabel}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5 opacity-70" />
                      {card.travelers} travelers
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5 opacity-70" />
                      {card.place}
                    </span>
                  </span>
                </span>
                <Badge className="shrink-0 border-transparent bg-sidebar-accent font-bold text-accent">{card.stage}</Badge>
              </span>
              <span className="mt-4 flex items-center gap-2.5">
                <Progress value={card.progress} className="min-w-0 flex-1 gap-0">
                  <ProgressTrack className="h-[7px] bg-bg-muted">
                    <ProgressIndicator className="bg-accent" />
                  </ProgressTrack>
                </Progress>
                <span className="shrink-0 text-[12.5px] font-semibold text-muted">Flight → Hotel → Invite</span>
              </span>
              <span className="mt-4 flex items-center gap-2">
                <TripPeople people={card.people} />
                <span className="text-[12.5px] font-normal text-muted">
                  {card.joined} of {card.travelers} travelers joined
                </span>
                <span className="trip-live-dot ml-1 size-2 rounded-full bg-success" aria-hidden />
              </span>
            </span>
          </Card>
        </Link>

        <h2 className="mb-3.5 text-[17px] font-bold tracking-tight">Quick actions</h2>
        <div className="mb-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/onboarding"
            className="flex min-h-[132px] flex-col justify-between rounded-[14px] bg-ink p-[18px] text-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
          >
            <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-white/12">
              <CirclePlus className="size-4" />
            </span>
            <span>
              <span className="mt-3.5 block text-[14.5px] font-bold">Start a new trip</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[#c9c2b2]">
                Braindump it, or answer a few quick questions.
              </span>
            </span>
          </Link>
          <Link
            href="/studio"
            className="flex min-h-[132px] flex-col justify-between rounded-[14px] bg-sidebar-accent p-[18px] text-ink transition hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
          >
            <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-white text-accent">
              <TrendingUp className="size-4" />
            </span>
            <span>
              <span className="mt-3.5 block text-[14.5px] font-bold">Continue planning</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                Pick up where you left off on the stay.
              </span>
            </span>
          </Link>
          <Dialog>
            <DialogTrigger className="flex min-h-[132px] flex-col justify-between rounded-[14px] border border-line bg-white p-[18px] text-left text-ink transition hover:-translate-y-0.5 hover:shadow-[var(--shadow)]">
              <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-bg-muted">
                <Users className="size-4" />
              </span>
              <span>
                <span className="mt-3.5 block text-[14.5px] font-bold">See who&rsquo;s joined</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                  {joined.length} of {trip.state.members.length} travelers have confirmed so far.
                </span>
              </span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Who&rsquo;s joined</DialogTitle>
                <DialogDescription>
                  {joined.length} of {trip.state.members.length} travelers are in. Placeholders still need the invite.
                </DialogDescription>
              </DialogHeader>
              <ul className="flex flex-col gap-3">
                {trip.state.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-[#fff0f3] text-[12px] font-bold text-accent">
                        {initials(member.name.trim() || "Traveler")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-semibold">{member.name.trim() || "Placeholder"}</span>
                    <Badge
                      variant="secondary"
                      className={member.joined ? "ml-auto bg-[#e7f3ec] text-success" : "ml-auto"}
                    >
                      {member.joined ? "Joined" : "Pending"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
          <button
            type="button"
            onClick={copyInvite}
            className="flex min-h-[132px] flex-col justify-between rounded-[14px] border border-line bg-white p-[18px] text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
          >
            <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-[#e7f3ec] text-success">
              <PenLine className="size-4" />
            </span>
            <span>
              <span className="mt-3.5 block text-[14.5px] font-bold">{copied ? "Link copied" : "Invite people"}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                {copied ? "Paste it for anyone not in the chat yet." : "Copy a link for the people not in chat yet."}
              </span>
            </span>
          </button>
        </div>

        <h2 className="mb-3.5 text-[17px] font-bold tracking-tight">Past trips</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAST_TRIPS.map((past) => (
            <Card key={past.title} className="gap-0 overflow-hidden rounded-[14px] py-0 shadow-[var(--shadow)] ring-line">
              <div className="relative h-24">
                <Image src={past.image} alt="" fill sizes="320px" className="object-cover" />
              </div>
              <div className="px-3.5 py-3">
                <h3 className="text-[13.5px] font-bold">{past.title}</h3>
                <p className="text-[12px] text-muted">{past.meta}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
