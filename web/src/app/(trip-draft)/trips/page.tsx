/** `/trips` → `TripsBoard`. Card hrefs come from `tripListCards` in `dashboard-data.ts`. */
import type { Metadata } from "next";
import { TripsBoard } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Trips" };

export default function TripsPage() {
  return <TripsBoard />;
}
