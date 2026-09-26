"use client";

/**
 * Trips list inside the dashboard shell. The in-progress card opens the live summary graph.
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
  const { state } = useTrip();
  const cards = tripListCards(state);

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
            className={cn(buttonVariants({ variant: "default" }), "h-11 rounded-[10px] bg-ink px-4 text-[13.5px] font-bold text-white hover:bg-black")}
          >
            <Plus className="size-4" />
            New trip
          </Link>
        </div>
        <div className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const body = (
              <Card className="gap-0 overflow-hidden rounded-[20px] py-0 shadow-[var(--shadow)] ring-line transition hover:-translate-y-0.5">
                <div className="relative h-[132px]">
                  <Image src={card.image} alt="" fill sizes="360px" className="object-cover" />
                  <Badge className="absolute top-2.5 left-2.5 border-transparent bg-white/90 text-accent">
                    {card.stage}
                  </Badge>
                </div>
                <div className="px-4 pt-3.5 pb-4">
                  <h2 className="text-[15px] font-bold">{card.title}</h2>
                  <p className="mt-1 mb-3 text-[12.5px] text-muted">
                    {card.datesLabel} · {card.place}
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
              <Link key={card.id} href={card.href} className="block">
                {body}
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
