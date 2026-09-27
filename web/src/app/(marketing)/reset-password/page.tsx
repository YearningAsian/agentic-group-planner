import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/components/brand-logo";
import { AuthShell, ResetPasswordForm } from "@/features/auth";

export const metadata: Metadata = {
  title: "Set new password",
  description: `Choose a new password for ${PRODUCT_NAME}.`,
};

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a password with at least 10 characters."
      sideImage={{
        src: "/media/japan-lantern-street.webp",
        alt: "A lantern-lit wooden street at dusk in a historic Japanese district.",
        caption: "You’re almost back in.",
      }}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
