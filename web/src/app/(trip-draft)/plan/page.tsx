/** `/plan` → `PlanPicker` (lock flight/stay, then `/progress`). Stay budget uses nightly price × nights. */
import type { Metadata } from "next";
import { PlanPicker } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Flights and stays" };

export default function PlanPage() {
  return <PlanPicker />;
}
