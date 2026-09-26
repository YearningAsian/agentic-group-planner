import type { Metadata } from "next";
import { ProgressGraph } from "@/components/progress-graph";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return <ProgressGraph />;
}
