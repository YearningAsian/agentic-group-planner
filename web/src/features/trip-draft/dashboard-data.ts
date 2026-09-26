/**
 * Dashboard fixtures and the in-progress card derived from the trip draft.
 * Sample Barcelona content shows until a questionnaire destination is saved (`inProgressCard` → `SAMPLE_BARCELONA`).
 * `tripListCards` is the Trips page: one draft card (`/current` if `destinationId` is set, else `/studio`) plus `OTHER_TRIPS`.
 */
import { destinationById } from "@/features/trip-draft/fixtures";
import { formatRange, initials, validRange } from "@/features/trip-draft/format";
import type { TripState } from "@/features/trip-draft/trip-context";

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=80`;

export type PersonChip = { label: string };

export type InProgressCard = {
  title: string;
  datesLabel: string;
  place: string;
  travelers: number;
  joined: number;
  stage: string;
  progress: number;
  image: string;
  people: PersonChip[];
};

export type TripListCard = InProgressCard & {
  id: string;
  href: "/studio" | "/current" | null;
  pending: string;
};

export type PastTrip = {
  title: string;
  meta: string;
  image: string;
};

export const PAST_TRIPS: PastTrip[] = [
  {
    title: "Lake Tahoe cabin",
    meta: "4 travelers · March 2026",
    image: photo("photo-1541849546-216549ae216d"),
  },
  {
    title: "Austin bachelor trip",
    meta: "6 travelers · Jan 2026",
    image: photo("photo-1502602898657-3e91760cbb34"),
  },
  {
    title: "Savannah long weekend",
    meta: "3 travelers · Nov 2025",
    image: photo("photo-1533105079780-92b9be482077"),
  },
];

const SAMPLE_BARCELONA: InProgressCard = {
  title: "Budget Stays Near Barcelona",
  datesLabel: "Oct 12 – 23",
  place: "Province of Barcelona",
  travelers: 3,
  joined: 2,
  stage: "Choosing stay",
  progress: 62,
  image: photo("photo-1583422409516-2895a77efded"),
  people: [{ label: "AT" }, { label: "MR" }, { label: "+1" }],
};

const OTHER_TRIPS: TripListCard[] = [
  {
    id: "porto",
    title: "Porto Long Weekend",
    datesLabel: "Nov 6 – 9",
    place: "Porto, Portugal",
    travelers: 5,
    joined: 3,
    stage: "Flight booked",
    progress: 70,
    image: photo("photo-1555881400-74d7acaacd8b"),
    people: [{ label: "AT" }, { label: "JL" }, { label: "+2" }],
    href: null,
    pending: "2 pending",
  },
  {
    id: "denver",
    title: "Denver Ski Weekend",
    datesLabel: "Jan 15 – 19",
    place: "Denver, CO",
    travelers: 5,
    joined: 1,
    stage: "Inviting people",
    progress: 40,
    image: photo("photo-1519677100203-a0e668c92439"),
    people: [{ label: "AT" }],
    href: null,
    pending: "4 pending",
  },
];

/** Prototype organizer until an account name exists. A renamed first member replaces it. */
export function organizerProfile(state: TripState) {
  const raw = state.members[0]?.name.trim() ?? "";
  if (!raw || raw === "Person 1") {
    return { name: "Alex Truong", handle: "@alex-truong", greeting: "Alex" };
  }
  const greeting = raw.split(/\s+/)[0] ?? raw;
  const handle =
    "@" +
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return { name: raw, handle, greeting };
}

export function greetingFor(name: string, now = new Date()) {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${name}`;
}

function peopleFrom(state: TripState): PersonChip[] {
  const visible = state.members.slice(0, 2).map((member) => ({
    label: initials(member.name.trim() || "Traveler"),
  }));
  const extra = state.members.length - visible.length;
  if (extra > 0) visible.push({ label: `+${extra}` });
  return visible;
}

/** The card on Home and the first card on Trips. Uses the draft when a city is saved. */
export function inProgressCard(state: TripState): InProgressCard {
  const destination = destinationById(state.destinationId);
  if (!destination) return SAMPLE_BARCELONA;
  const joined = state.members.filter((member) => member.joined).length;
  const progress = state.lockedStayId ? 84 : state.budget ? 62 : validRange(state.startDate, state.endDate) ? 45 : 28;
  return {
    title: state.lockedStayId ? `${destination.label} stay` : `Trip to ${destination.label}`,
    datesLabel: formatRange(state.startDate, state.endDate),
    place: `${destination.label}, ${destination.country}`,
    travelers: state.members.length,
    joined,
    stage: state.lockedStayId ? "Stay picked" : "Choosing stay",
    progress,
    image: destination.photos[0],
    people: peopleFrom(state),
  };
}

export function tripListCards(state: TripState): TripListCard[] {
  const current = inProgressCard(state);
  const pending = Math.max(current.travelers - current.joined, 0);
  return [
    {
      ...current,
      id: "current",
      href: state.destinationId ? "/current" : "/studio",
      pending: pending === 0 ? "Everyone's in" : `${pending} pending`,
    },
    ...OTHER_TRIPS,
  ];
}
