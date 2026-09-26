"use client";

import { useContext } from "react";
import Link from "next/link";
import { TripContext } from "@/features/trip-draft/trip-context";

const linkClass =
  "flex min-h-11 items-center gap-3 rounded-2xl px-4 py-3 ring-1 ring-line hover:ring-ink";

/** First screen of a new trip. Questionnaire → `/onboarding?entry=questions`. Chat → `/studio`. There is no `?entry=chat`. */
export function EntryChoice() {
  const trip = useContext(TripContext);

  function handleStartNew() {
    if (trip && trip.state.id) {
      trip.startNewTrip();
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-5 py-6">
      <p className="text-[13px] font-semibold text-muted">Group Trip Agent</p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-tight text-balance">Start a new trip</h1>
      <p className="mt-2 text-[15px] text-muted">Answer a few questions, or just chat. Both open the live map.</p>
      <div className="mt-6 flex flex-col gap-3">
        <Link href="/onboarding?entry=questions" onClick={handleStartNew} className={linkClass}>
          <span aria-hidden>📋</span>
          <span>
            <span className="block text-[16px] font-semibold">Questionnaire</span>
            <span className="block text-[14px] text-muted">One question at a time, about 2 minutes</span>
          </span>
        </Link>
        <Link href="/studio" onClick={handleStartNew} className={linkClass}>
          <span aria-hidden>💬</span>
          <span>
            <span className="block text-[16px] font-semibold">Chat</span>
            <span className="block text-[14px] text-muted">Describe the trip in your own words</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
