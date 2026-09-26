/** `/onboarding`. Suspense is required: `OnboardingEntry` reads `useSearchParams`. */
import { Suspense } from "react";
import type { Metadata } from "next";
import { OnboardingEntry } from "@/features/trip-draft/components/onboarding-entry";

export const metadata: Metadata = { title: "Start a trip" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-surface" role="status"><span className="sr-only">Loading</span></div>}>
      <OnboardingEntry />
    </Suspense>
  );
}
