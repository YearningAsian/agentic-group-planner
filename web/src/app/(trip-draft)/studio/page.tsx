import type { Metadata } from "next";
import { PlannerStudio } from "@/features/trip-draft/components/planner-studio";

export const metadata: Metadata = { title: "Planner" };

/** Chat and live map. The questionnaire hands off here after the last continue. */
export default function StudioPage() {
  return <PlannerStudio />;
}
