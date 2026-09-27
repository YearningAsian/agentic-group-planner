import type { TripView } from "./types";

/** Problems in a view the lanes and the map would disagree on. Empty means the view is consistent. */
export function checkTripView(view: TripView): string[] {
  const problems: string[] = [];
  for (const leg of view.legs) {
    const from = view.stops[leg.fromItemId];
    const to = view.stops[leg.toItemId];
    if (!from) problems.push(`leg from ${leg.fromItemId} has no stop`);
    if (!to) problems.push(`leg to ${leg.toItemId} is missing a stop`);
    if (to?.kind === "place" && leg.style === "dashed") problems.push(`dashed leg ends at place stop ${leg.toItemId}`);
    if (to?.kind === "provisional" && leg.style === "solid") problems.push(`solid leg ends at provisional stop ${leg.toItemId}`);
  }
  return problems;
}
