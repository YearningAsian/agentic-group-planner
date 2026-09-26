"use client";

import { useSearchParams } from "next/navigation";
import { EntryChoice } from "@/features/trip-draft/components/entry-choice";
import { OnboardingFlow } from "@/features/trip-draft/components/onboarding-flow";

/** `/onboarding` host: choice first, questionnaire only after an explicit pick. */
export function OnboardingEntry() {
  const params = useSearchParams();
  if (params.get("entry") === "questions") return <OnboardingFlow />;
  return <EntryChoice />;
}
