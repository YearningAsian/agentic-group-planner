/** `/i/[code]` opens the same itinerary the summary share link points at. */
import type { Metadata } from "next";
import { ItineraryView } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Shared itinerary" };

export default function SharedItineraryPage() {
  return <ItineraryView />;
}
