"use client";

import type { ItineraryChangeCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function ItineraryChangeCardView({ payload }: { payload: ItineraryChangeCard }) {
  return (
    <article data-card-type="itinerary_change" aria-label="itinerary change card">
      <p>{payload.card_type}</p>
    </article>
  );
}
