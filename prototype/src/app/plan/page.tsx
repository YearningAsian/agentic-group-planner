import type { Metadata } from "next";
import { PlanPicker } from "@/components/plan-picker";

export const metadata: Metadata = { title: "Flights and stays" };

export default function PlanPage() {
  return <PlanPicker />;
}
