import type { ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { TripProvider } from "@/features/trip-draft/trip-context";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

/**
 * Prototype trip-draft shell. Palette class `.trip-draft`. Do not search `features/map`, `features/chat`, or `lib/trip-view` — those stubs are unused here.
 * State: `features/trip-draft/trip-context.tsx` (`useTrip`, sessionStorage `agp-trip-draft`). Cities/fares/stays: `fixtures.ts`. Home/Trips samples: `dashboard-data.ts`. Money/dates: `format.ts`.
 * Sidebar: `components/app-shell.tsx`. Older-screen header/chips: `components/chrome.tsx`. Map entry: `components/trip-map.tsx`.
 *
 * Route → page file → component:
 * `/` → `page.tsx` → `dashboard-home.tsx`
 * `/onboarding` → `onboarding/page.tsx` → `onboarding-entry.tsx` (choice). `?entry=questions` → `onboarding-flow.tsx` (no sidebar; finish goes to `/studio`)
 * `/studio` → `studio/page.tsx` → `planner-studio.tsx` (chat + map)
 * `/trips` → `trips/page.tsx` → `trips-board.tsx`
 * `/current` → `current/page.tsx` → `trip-summary.tsx`
 * `/plan` → `plan/page.tsx` → `plan-picker.tsx`
 * `/progress` → `progress/page.tsx` → `progress-graph.tsx`
 * `/itinerary` → `itinerary/page.tsx` → `itinerary-view.tsx`
 */
export default function TripDraftLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${jakarta.variable} trip-draft min-h-dvh antialiased`}>
      <TripProvider>{children}</TripProvider>
    </div>
  );
}
