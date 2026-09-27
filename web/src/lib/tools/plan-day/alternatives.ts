/**
 * The places a plan may offer. `update_item`'s request_alternatives excludes the places an item
 * already offered, so the group gets new ones; a booked or pinned stop keeps its place, because it
 * rides along in the request as context (design §2.1 `plan_day`).
 */
export function offerablePlaces<P extends { id: string }>(
  places: readonly P[],
  items: readonly { status: string; pinned: boolean; place_id?: string | null }[],
  exclude: ReadonlySet<string> | undefined,
): P[] {
  if (!exclude || exclude.size === 0) return [...places];
  const fixed = new Set(items.filter((i) => i.pinned || i.status === "booked").map((i) => i.place_id));
  return places.filter((p) => !exclude.has(p.id) || fixed.has(p.id));
}
