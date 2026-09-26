/** What the lanes and the map both render. Built from database rows by buildTripView (FE-218). */
export interface TripView {
  members: LaneMember[];
  slots: SlotView[];
  stops: Record<string, StopView>;
  legs: LegView[];
  branches: BranchPoint[];
  merges: MergePoint[];
}

export interface LaneMember {
  memberId: string;
  displayName: string;
  initials: string;
  laneToken: string;
}

export interface SlotView {
  slotKey: string;
  groups: { memberIds: string[]; itemIds: string[] }[];
}

export type StopView =
  | { kind: "place"; itemId: string; label: string; number: number; lat: number; lng: number }
  | { kind: "provisional"; itemId: string; label: string; area: string; lat: number; lng: number };

export interface LegView {
  memberId: string;
  fromItemId: string;
  toItemId: string;
  style: "solid" | "dashed";
  mode: "walking" | "driving" | null;
  minutes: number | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface BranchPoint {
  slotKey: string;
  groups: string[][];
}

export interface MergePoint {
  slotKey: string;
  itemId: string;
  memberIds: string[];
}
