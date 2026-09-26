/**
 * Overlapping initials for a trip card. `+N` chips count travelers that don't fit.
 */
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import type { PersonChip } from "@/features/trip-draft/dashboard-data";
import { cn } from "@/lib/utils";

const TONES = ["bg-accent-tint text-accent", "bg-good-tint text-success", "bg-bg-muted text-ink"];

export function TripPeople({ people, size = "md" }: { people: PersonChip[]; size?: "sm" | "md" }) {
  const dimension = size === "sm" ? "size-[22px] text-[10px]" : "size-[26px] text-[11px]";
  return (
    <AvatarGroup>
      {people.map((person, index) => (
        <Avatar key={`${person.label}-${index}`} className={cn(dimension, "border-2 border-white")}>
          <AvatarFallback className={cn("font-bold", dimension, TONES[index % TONES.length])}>
            {person.label}
          </AvatarFallback>
        </Avatar>
      ))}
    </AvatarGroup>
  );
}
