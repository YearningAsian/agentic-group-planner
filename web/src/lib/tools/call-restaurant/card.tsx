"use client";

import type { CallStatusCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function CallStatusCardView({ payload }: { payload: CallStatusCard }) {
  return (
    <article data-card-type="call_status" aria-label="call status card">
      <p>{payload.card_type}</p>
    </article>
  );
}
