"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInAction, signUpAction } from "../server/auth-actions";
import { passwordStrength, strengthLabel } from "../schemas";
import { cn } from "cn";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger" role="alert">
      {message}
    </p>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        setFieldErrors({});
        startTransition(() => {
          void signInAction({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
            next,
          }).then((result) => {
            if (!result.ok) {
              setError(result.message);
              setFieldErrors(result.fieldErrors ?? {});
              return;
            }
            router.replace(result.next);
            router.refresh();
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
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          className="h-11 rounded-[14px] bg-paper text-base"
        />
        <FieldError id={`${emailId}-error`} message={fieldErrors.email} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor={passwordId} className="block text-sm font-medium text-ink">
            Password
          </label>
          <a href="/forgot-password" className="text-sm font-medium text-lagoon-ink hover:underline">
            Forgot password?
          </a>
        </div>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? `${passwordId}-error` : error ? errorId : undefined}
            className="h-11 rounded-[14px] bg-paper pr-11 text-base"
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <FieldError id={`${passwordId}-error`} message={fieldErrors.password} />
      </div>
      <div id={errorId} aria-live="polite" className="min-h-5 text-sm text-danger">
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
            Logging in…
          </>
        ) : (
          "Log in"
        )}
      </Button>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const hintId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);

  if (checkEmail) {
    return (
      <div className="space-y-3 rounded-[14px] border border-line bg-mist/60 p-4" role="status">
        <h2 className="text-lg font-semibold text-ink">Check your email</h2>
        <p className="text-sm text-muted">
          We sent a confirmation link. Open it to finish creating your account, then you’ll land in
          your trips.
        </p>
      </div>
    );
  }

  const strength = passwordStrength(password);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        setFieldErrors({});
        startTransition(() => {
          void signUpAction({
            displayName: String(form.get("displayName") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
            next,
          }).then((result) => {
            if (!result.ok) {
              setError(result.message);
              setFieldErrors(result.fieldErrors ?? {});
              return;
            }
            if (result.checkEmail) {
              setCheckEmail(true);
              return;
            }
            router.replace(result.next);
            router.refresh();
          });
        });
      }}
    >
      <div>
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-ink">
          Display name
        </label>
        <Input
          id={nameId}
          name="displayName"
          type="text"
          autoComplete="name"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.displayName)}
          aria-describedby={fieldErrors.displayName ? `${nameId}-error` : undefined}
          className="h-11 rounded-[14px] bg-paper text-base"
        />
        <FieldError id={`${nameId}-error`} message={fieldErrors.displayName} />
      </div>
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
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          className="h-11 rounded-[14px] bg-paper text-base"
        />
        <FieldError id={`${emailId}-error`} message={fieldErrors.email} />
      </div>
      <div>
        <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-ink">
          Password
        </label>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={10}
            disabled={pending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={cn(hintId, fieldErrors.password ? `${passwordId}-error` : undefined)}
            className="h-11 rounded-[14px] bg-paper pr-11 text-base"
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {password ? strengthLabel(strength) : "At least 10 characters."}
        </p>
        <FieldError id={`${passwordId}-error`} message={fieldErrors.password} />
      </div>
      <div id={errorId} aria-live="polite" className="min-h-5 text-sm text-danger">
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
            Creating account…
          </>
        ) : (
          "Create account"
        )}
      </Button>
    </form>
  );
}
