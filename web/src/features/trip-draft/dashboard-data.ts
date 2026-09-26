/**
 * Dashboard card helpers derived from the trip draft and trips database.
 * No demo trips or seeded mocks — empty until user creates a trip.
 */
import { destinationById } from "@/features/trip-draft/fixtures";
import { formatRange, initials, validRange } from "@/features/trip-draft/format";
import type { TripState, TripRecord } from "@/features/trip-draft/trip-context";

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

export const PAST_TRIPS: PastTrip[] = [];

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

/** The card on Home. Returns null when no destination has been chosen. */
export function inProgressCard(state: TripState): InProgressCard | null {
  const destination = destinationById(state.destinationId);
  if (!destination) return null;
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

export function tripListCards(state: TripState, trips?: TripRecord[]): TripListCard[] {
  if (trips && trips.length > 0) {
    return trips.map((t) => {
      const destination = destinationById(t.destinationId);
      const joined = t.members.filter((m) => m.joined).length;
      const progress = t.lockedStayId ? 84 : t.budget ? 62 : validRange(t.startDate, t.endDate) ? 45 : 28;
      const pending = Math.max(t.members.length - joined, 0);
      return {
        id: t.id,
        title: t.lockedStayId
          ? `${destination?.label ?? "Trip"} stay`
          : `Trip to ${destination?.label ?? (t.destinationQuery || "Draft")}`,
        datesLabel: formatRange(t.startDate, t.endDate),
        place: destination ? `${destination.label}, ${destination.country}` : (t.destinationQuery || "TBD"),
        travelers: t.members.length,
        joined,
        stage: t.lockedStayId ? "Stay picked" : "Choosing stay",
        progress,
        image: destination?.photos[0] ?? photo("photo-1555881400-74d7acaacd8b"),
        people: peopleFrom(t),
        href: t.destinationId ? "/current" : "/studio",
        pending: pending === 0 ? "Everyone's in" : `${pending} pending`,
      };
    });
  }

  const current = inProgressCard(state);
  if (!current) return [];
  const pending = Math.max(current.travelers - current.joined, 0);
  return [
    {
      ...current,
      id: state.id ?? "current",
      href: state.destinationId ? "/current" : "/studio",
      pending: pending === 0 ? "Everyone's in" : `${pending} pending`,
    },
  ];
}
