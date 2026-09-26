import type { RouteMode } from "@agp/shared";
import { formatUsd } from "@/lib/money";

export interface ReasoningInput {
  place: { tags: readonly string[]; rating: number | null };
  /** Per person, integer cents. */
  priceCents: number;
  /** The group the option is for, in member order. */
  members: readonly { name: string; interests: readonly string[] }[];
  /** From the group's previous stop; null when there's none. */
  travel: { minutes: number; mode: RouteMode } | null;
}

/**
 * An option's one-line reasoning, written by the server from facts (design §2.1, §11.3 item 8):
 * the member whose interests the place matches best, the price per person, and the travel from the
 * previous stop, e.g. "Best fit for Person 2's interests (animals, outdoors) · $42 · 12 min walk".
 * No model call, so every number in it is one the card also shows.
 */
export function optionReasoning(input: ReasoningInput): string {
  const tags = new Set(input.place.tags);
  let best: { name: string; matched: string[] } | null = null;
  for (const member of input.members) {
    const matched = member.interests.filter((interest) => tags.has(interest));
    // Strictly more, so a tie goes to the member listed first.
    if (matched.length > (best?.matched.length ?? 0)) best = { name: member.name, matched };
  }
  const fit = best
    ? `Best fit for ${best.name}'s interests (${best.matched.join(", ")})`
    : input.place.rating === null
      ? null
      : `Rated ${input.place.rating.toFixed(1)}`;
  const price = input.priceCents === 0 ? "Free" : formatUsd(input.priceCents);
  const travel =
    input.travel === null
      ? null
      : input.travel.minutes === 0
        ? "Same place as before"
        : `${input.travel.minutes} min ${input.travel.mode === "walking" ? "walk" : "drive"}`;
  return [fit, price, travel].filter((part): part is string => part !== null).join(" · ");
}
