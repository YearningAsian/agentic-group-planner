import type { Metadata } from "next";
import { ProfileScreen } from "@/features/trip-draft";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProfileScreen />;
}
