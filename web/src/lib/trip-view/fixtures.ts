import type { LegView, StopView, TripView } from "./types";

function line(): LegView["geometry"] {
  return { type: "LineString", coordinates: [[-84.39, 33.76], [-84.38, 33.77]] };
}

function place(itemId: string, label: string, number: number): StopView {
  return { kind: "place", itemId, label, number, lat: 33.76 + number / 100, lng: -84.39 };
}

function leg(memberId: string, fromItemId: string, toItemId: string, style: "solid" | "dashed"): LegView {
  return {
    memberId,
    fromItemId,
    toItemId,
    style,
    mode: style === "dashed" ? null : "walking",
    minutes: style === "dashed" ? null : 12,
    geometry: line(),
  };
}

const members = [
  { memberId: "p1", displayName: "Person 1", initials: "P1", laneToken: "lane-1" },
  { memberId: "p2", displayName: "Person 2", initials: "P2", laneToken: "lane-2" },
  { memberId: "p3", displayName: "Person 3", initials: "P3", laneToken: "lane-3" },
  { memberId: "p4", displayName: "Person 4", initials: "P4", laneToken: "lane-4" },
];

const all = ["p1", "p2", "p3", "p4"];

/** Seeded Saturday after planning: afternoon splits, dinner is provisional in Midtown. */
export const votingFixture: TripView = {
  members,
  slots: [
    { slotKey: "morning", groups: [{ memberIds: all, itemIds: ["morning"] }] },
    { slotKey: "lunch", groups: [{ memberIds: all, itemIds: ["lunch"] }] },
    {
      slotKey: "afternoon",
      groups: [
        { memberIds: ["p1", "p4"], itemIds: ["afternoon-a"] },
        { memberIds: ["p2", "p3"], itemIds: ["afternoon-b"] },
      ],
    },
    { slotKey: "dinner", groups: [{ memberIds: all, itemIds: ["dinner"] }] },
  ],
  stops: {
    morning: place("morning", "Georgia Aquarium", 1),
    lunch: place("lunch", "Ponce City Market", 2),
    "afternoon-a": place("afternoon-a", "Piedmont Park", 3),
    "afternoon-b": place("afternoon-b", "High Museum", 4),
    dinner: { kind: "provisional", itemId: "dinner", label: "Dinner, TBD", area: "Midtown", lat: 33.781, lng: -84.383 },
  },
  legs: [
    ...all.flatMap((id) => [leg(id, "morning", "lunch", "solid")]),
    leg("p1", "lunch", "afternoon-a", "solid"),
    leg("p4", "lunch", "afternoon-a", "solid"),
    leg("p2", "lunch", "afternoon-b", "solid"),
    leg("p3", "lunch", "afternoon-b", "solid"),
    leg("p1", "afternoon-a", "dinner", "dashed"),
    leg("p4", "afternoon-a", "dinner", "dashed"),
    leg("p2", "afternoon-b", "dinner", "dashed"),
    leg("p3", "afternoon-b", "dinner", "dashed"),
  ],
  branches: [{ slotKey: "afternoon", groups: [["p1", "p4"], ["p2", "p3"]] }],
  merges: [{ slotKey: "dinner", itemId: "dinner", memberIds: all }],
};

/** After the pay flow: dinner is a place, every leg is solid. */
export const bookedFixture: TripView = {
  ...votingFixture,
  stops: {
    ...votingFixture.stops,
    dinner: place("dinner", "Midtown Supper", 5),
  },
  legs: votingFixture.legs.map((item) => (item.toItemId === "dinner" ? leg(item.memberId, item.fromItemId, "dinner", "solid") : item)),
};

/** Dinner has no area, so there is no dinner stop and each lane ends at the afternoon. */
export const noAreaFixture: TripView = {
  members,
  slots: votingFixture.slots.filter((slot) => slot.slotKey !== "dinner"),
  stops: {
    morning: votingFixture.stops.morning!,
    lunch: votingFixture.stops.lunch!,
    "afternoon-a": votingFixture.stops["afternoon-a"]!,
    "afternoon-b": votingFixture.stops["afternoon-b"]!,
  },
  legs: votingFixture.legs.filter((item) => item.toItemId !== "dinner"),
  branches: votingFixture.branches,
  merges: [],
};
