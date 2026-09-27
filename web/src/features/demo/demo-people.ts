/** The seeded people behind the instant logins. Person 4 joins later through the invite link. */
export const DEMO_PEOPLE = [
  { key: "person1", name: "Person 1", role: "Organizer", lane: 1 },
  { key: "person2", name: "Person 2", role: "Vegetarian", lane: 2 },
  { key: "person3", name: "Person 3", role: null, lane: 3 },
] as const;

export type DemoPersonKey = (typeof DEMO_PEOPLE)[number]["key"];

export function isDemoPersonKey(value: unknown): value is DemoPersonKey {
  return DEMO_PEOPLE.some((person) => person.key === value);
}
