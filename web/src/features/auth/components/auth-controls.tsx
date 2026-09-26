"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/** Sign-in / sign-up when signed out; Clerk user menu when signed in. */
export function AuthControls({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-bg-muted"
          >
            Sign in
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button
            type="button"
            className="h-9 rounded-lg bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-[#302a22]"
          >
            Sign up
          </Button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-8",
            },
          }}
        />
      </Show>
    </div>
  );
}
