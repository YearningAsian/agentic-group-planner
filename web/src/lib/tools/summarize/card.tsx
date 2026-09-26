"use client";

import type { SummaryCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function SummaryCardView({ payload }: { payload: SummaryCard }) {
  return (
    <article data-card-type="summary" aria-label="summary card">
      <p>{payload.card_type}</p>
    </article>
  );
}
