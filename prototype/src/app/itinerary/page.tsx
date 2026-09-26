import type { Metadata } from "next";
import { ItineraryView } from "@/components/itinerary-view";

export const metadata: Metadata = { title: "Itinerary" };

export default function ItineraryPage() {
  return <ItineraryView />;
}
