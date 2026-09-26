"use client";

import type { RecapCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function RecapCardView({ payload }: { payload: RecapCard }) {
  return (
    <article data-card-type="recap" aria-label="recap card">
      <p>{payload.card_type}</p>
    </article>
  );
}
