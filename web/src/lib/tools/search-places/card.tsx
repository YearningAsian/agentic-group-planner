"use client";

import type { PlaceListCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function PlaceListCardView({ payload }: { payload: PlaceListCard }) {
  return (
    <article data-card-type="place_list" aria-label="place list card">
      <p>{payload.card_type}</p>
    </article>
  );
}
