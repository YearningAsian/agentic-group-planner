import type { Metadata } from "next";
import {
  AuthDivider,
  AuthShell,
  AuthSwitchLink,
  LoginForm,
} from "@/features/auth";
import { InstantLoginCards } from "@/features/demo";
import { safeNextPath } from "@/lib/supabase/auth-routes";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Group Trip Agent to plan with your group.",
};

type PageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next) ?? undefined;
  const linkError = params.error === "link";

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to open your trips, chat with the agent, and approve your share."
      sideImage={{
        src: "/media/lisbon-tram.webp",
        alt: "A classic yellow vintage tram descending a steep cobblestone street in Lisbon during golden hour, with the Tagus River and the 25 de Abril bridge behind.",
        caption: "Lisbon — plan the day, then ride it together.",
      }}
      footer={
        <AuthSwitchLink
          prompt="New here?"
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          label="Create an account"
        />
      }
    >
      {linkError ? (
        <p className="rounded-[14px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          That sign-in link is invalid or expired. Log in below, or request a new one.
        </p>
      ) : null}
      <InstantLoginCards next={next} />
      {process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? <AuthDivider label="or log in with email" /> : null}
      <LoginForm next={next} />
    </AuthShell>
  );
}
