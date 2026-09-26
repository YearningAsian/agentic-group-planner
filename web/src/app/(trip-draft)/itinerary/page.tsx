/** `/itinerary` → `ItineraryView`. Empty until both a flight and a stay are locked in `useTrip`. */
import type { Metadata } from "next";
import { ItineraryView } from "@/features/trip-draft/components/itinerary-view";

export const metadata: Metadata = { title: "Itinerary" };

export default function ItineraryPage() {
  return <ItineraryView />;
}
