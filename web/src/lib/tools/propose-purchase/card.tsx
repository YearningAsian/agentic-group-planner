"use client";

import type { ApprovalCard } from "@agp/shared";

/** Stub renderer: names the card type until the card's owner builds it. */
export function ApprovalCardView({ payload }: { payload: ApprovalCard }) {
  return (
    <article data-card-type="approval" aria-label="approval card">
      <p>{payload.card_type}</p>
    </article>
  );
}
