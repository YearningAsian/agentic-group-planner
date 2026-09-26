"use client";

/**
 * Trips list inside the dashboard shell.
 * Shows all user trips from local storage, or an empty state if none exist.
 */
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/features/trip-draft/components/app-shell";
import { TripPeople } from "@/features/trip-draft/components/trip-people";
import { tripListCards } from "@/features/trip-draft/dashboard-data";
import { useTrip } from "@/features/trip-draft/trip-context";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function TripsBoard() {
  const trip = useTrip();
  const cards = tripListCards(trip.state, trip.trips);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1080px] px-6 py-9 sm:px-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight">Trips</h1>
            <p className="mt-1.5 text-[14px] text-muted">
              Everything you&rsquo;re planning, and everything you&rsquo;ve already been on.
            </p>
          </div>
          <Link
            href="/onboarding"
            onClick={() => trip.startNewTrip()}
            className={cn(
              buttonVariants({ variant: "default" }),
              "h-11 rounded-[10px] bg-ink px-4 text-[13.5px] font-bold text-white hover:bg-[#302a22]",
            )}
          >
            <Plus className="size-4" />
            New trip
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-line bg-[#fbf9f5] p-12 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-line">
              <Plus className="size-6 text-muted" />
            </div>
            <h2 className="mt-4 text-[18px] font-bold text-ink">No trips yet</h2>
            <p className="mx-auto mt-1 max-w-[360px] text-[13.5px] text-muted">
              You haven&rsquo;t created any trips yet. Start planning your first getaway now.
            </p>
            <div className="mt-5">
              <Link
                href="/onboarding"
                onClick={() => trip.startNewTrip()}
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "h-10 rounded-[10px] bg-ink px-4 text-[13.5px] font-bold text-white hover:bg-[#302a22]",
                )}
              >
                <Plus className="size-4" />
                Create your first trip
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const body = (
                <Card className="gap-0 overflow-hidden rounded-[20px] border border-line py-0 shadow-[var(--shadow)] transition hover:-translate-y-0.5">
                  <div className="relative h-[132px]">
                    <Image src={card.image} alt="" fill sizes="360px" className="object-cover" />
                    <Badge className="absolute top-2.5 left-2.5 border-transparent bg-white/90 text-accent">
                      {card.stage}
                    </Badge>
                  </div>
                  <div className="px-4 pt-3.5 pb-4">
                    <h2 className="text-[15px] font-bold">{card.title}</h2>
                    <p className="mt-1 mb-3 text-[12.5px] text-muted">
                      {card.datesLabel}, {card.place}
                    </p>
                    <div className="flex items-center justify-between">
                      <TripPeople people={card.people} size="sm" />
                      <span className="text-[11.5px] font-semibold text-muted">{card.pending}</span>
                    </div>
                  </div>
                </Card>
              );
              if (!card.href) {
                return (
                  <div key={card.id} className="opacity-100">
                    {body}
                  </div>
                );
              }
              return (
                <Link
                  key={card.id}
                  href={card.href}
                  onClick={() => trip.selectTrip(card.id)}
                  className="block"
                >
                  {body}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
