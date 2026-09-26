"use client";

import type { PlanCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function PlanCardView({ payload }: { payload: PlanCard }) {
  return (
    <article data-card-type="plan" aria-label="plan card">
      <p>{payload.card_type}</p>
    </article>
  );
}
