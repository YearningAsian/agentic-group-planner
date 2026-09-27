import type { Metadata } from "next";
import { DashboardHome } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Home" };

/** Dashboard home (moved from `/` so the marketing landing can own `/`). */
export default function HomePage() {
  return <DashboardHome />;
}
