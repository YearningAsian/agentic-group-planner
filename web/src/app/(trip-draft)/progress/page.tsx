/** `/progress` → `ProgressGraph` (flight → hotel → invite). Needs a locked flight and stay before the invite step. */
import type { Metadata } from "next";
import { ProgressGraph } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return <ProgressGraph />;
}
