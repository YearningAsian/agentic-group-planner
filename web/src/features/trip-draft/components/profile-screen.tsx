"use client";

import { AppShell } from "@/features/trip-draft/components/app-shell";
import { ProfileForm } from "@/features/trip-draft/components/profile-form";

export function ProfileScreen() {
  return (
    <AppShell>
      <ProfileForm />
    </AppShell>
  );
}
