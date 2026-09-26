import type { Metadata } from "next";
import { TripSummary } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Current trip" };

/** Live Flights → Hotel → Invite dashboard for the trip selected in this session. */
export default function CurrentTripPage() {
  return <TripSummary />;
}
