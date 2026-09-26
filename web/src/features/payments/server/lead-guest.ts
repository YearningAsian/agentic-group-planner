import "server-only";
import { AppError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import { type LeadGuest, leadGuestFrom } from "../lib/lead-guest";

/** The organizer as the hotel's lead guest, from their account's email and phone; null if either is missing. */
export async function loadLeadGuest(admin: AdminClient, organizer: { display_name: string; profile_id: string | null }): Promise<LeadGuest | null> {
  if (!organizer.profile_id) return null;
  const { data, error } = await admin.auth.admin.getUserById(organizer.profile_id);
  if (error) throw new AppError("provider_unavailable", "Couldn't read the organizer's contact details.", { cause: error });
  const metadataPhone = data.user.user_metadata?.phone;
  return leadGuestFrom({
    displayName: organizer.display_name,
    email: data.user.email ?? null,
    phone: data.user.phone || (typeof metadataPhone === "string" ? metadataPhone : null),
  });
}

export const MISSING_GUEST_MESSAGE = "Booking a hotel needs the organizer's email and phone number on their account.";
