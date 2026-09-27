"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forgotPasswordAction, resetPasswordAction } from "../server/auth-actions";

export function ForgotPasswordForm() {
  const emailId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-3 rounded-[14px] border border-line bg-mist/60 p-4" role="status">
        <h2 className="text-lg font-semibold text-ink">Check your email</h2>
        <p className="text-sm text-muted">
          If an account exists for that address, we sent a link to set a new password.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        startTransition(() => {
          void forgotPasswordAction({ email: String(form.get("email") ?? "") }).then((result) => {
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setSent(true);
          });
        });
      }}
    >
      <div>
        <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-ink">
          Email
        </label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className="h-11 rounded-[14px] bg-paper text-base"
        />
      </div>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">
        {error || null}
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-full bg-coral text-base font-semibold text-ink hover:bg-coral/90"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Sending…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const passwordId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        startTransition(() => {
          void resetPasswordAction({ password: String(form.get("password") ?? "") }).then((result) => {
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.replace(result.next);
            router.refresh();
          });
        });
      }}
    >
      <div>
        <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-ink">
          New password
        </label>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          disabled={pending}
          className="h-11 rounded-[14px] bg-paper text-base"
        />
        <p className="mt-1.5 text-xs text-muted">At least 10 characters.</p>
      </div>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">
        {error || null}
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-full bg-coral text-base font-semibold text-ink hover:bg-coral/90"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Saving…
          </>
        ) : (
          "Set new password"
        )}
      </Button>
    </form>
  );
}
