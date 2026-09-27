import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/components/brand-logo";
import { AuthShell, AuthSwitchLink, ForgotPasswordForm } from "@/features/auth";

export const metadata: Metadata = {
  title: "Forgot password",
  description: `Reset your ${PRODUCT_NAME} password.`,
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot password"
      subtitle="Enter your email and we’ll send a link to set a new password."
      sideImage={{
        src: "/media/lisbon-tram.webp",
        alt: "A classic yellow vintage tram descending a steep cobblestone street in Lisbon during golden hour.",
        caption: "Lisbon — back on track in one tap.",
      }}
      footer={<AuthSwitchLink prompt="Remembered it?" href="/login" label="Log in" />}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
