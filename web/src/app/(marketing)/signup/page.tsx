import type { Metadata } from "next";
import { AuthShell, AuthSwitchLink, SignUpForm } from "@/features/auth";
import { safeNextPath } from "@/lib/supabase/auth-routes";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Group Trip Agent account to plan trips with your group.",
};

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignUpPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next) ?? undefined;

  return (
    <AuthShell
      title="Create your account"
      subtitle="Invite the group, chat with the agent, and approve your own share when it’s time to book."
      sideImage={{
        src: "/media/japan-lantern-street.webp",
        alt: "A lantern-lit wooden street at dusk in a historic Japanese district, with a bicycle parked against a building.",
        caption: "Remember the evenings you planned for.",
      }}
      footer={
        <AuthSwitchLink
          prompt="Already have an account?"
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          label="Log in"
        />
      }
    >
      <SignUpForm next={next} />
    </AuthShell>
  );
}
