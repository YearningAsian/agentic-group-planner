import type { Metadata } from "next";
import { DashboardHome } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Home" };

/** Dashboard home. The questionnaire still starts at `/onboarding`. */
export default function HomePage() {
  return <DashboardHome />;
}
