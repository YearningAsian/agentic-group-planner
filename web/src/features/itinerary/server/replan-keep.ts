/** A live item in a slot being re-planned, with what the group currently leans toward. */
export interface LiveSlotItem {
  id: string;
  slot_key: string;
  status: string;
  /** Its attendee rows; none means everyone together. */
  attendees: readonly string[];
  /** The chosen option's place when decided, else the rank-1 option's; null if it has none. */
  best_place_id: string | null;
}

interface AnswerSlot {
  slot_key: string;
  groups: readonly { member_ids: readonly string[]; options: readonly { place_id: string; rank: number }[] }[];
}

const KEEPABLE = new Set(["voting", "decided"]);

const groupKey = (memberIds: readonly string[]) => [...memberIds].sort().join(",");

/**
 * The slots a replan leaves as they are: every live item is voting or decided, and the planner's
 * answer has the same groups, each with that item's best place as its top option. Superseding
 * such a slot would only throw away the group's discussion for the same outcome.
 */
export function unchangedSlots(input: { everyone: readonly string[]; live: readonly LiveSlotItem[]; answer: readonly AnswerSlot[] }): Set<string> {
  const kept = new Set<string>();
  for (const slot of input.answer) {
    const items = input.live.filter((i) => i.slot_key === slot.slot_key);
    if (items.length === 0 || items.length !== slot.groups.length) continue;
    if (items.some((i) => !KEEPABLE.has(i.status) || !i.best_place_id)) continue;
    const bestByGroup = new Map(items.map((i) => [groupKey(i.attendees.length > 0 ? i.attendees : input.everyone), i.best_place_id]));
    const same = slot.groups.every((g) => {
      const top = [...g.options].sort((a, b) => a.rank - b.rank)[0];
      return top !== undefined && bestByGroup.get(groupKey(g.member_ids)) === top.place_id;
    });
    if (same) kept.add(slot.slot_key);
  }
  return kept;
}
