"use server";
import "server-only";
import { getServerClient } from "@/lib/supabase/server";
import { getClientEnv } from "@/lib/env/client";
import { messageForAuthError } from "../auth-errors";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "../schemas";
import { safeNextPath, TRIPS_HOME } from "@/lib/supabase/auth-routes";

export type AuthActionResult =
  | { ok: true; next: string; checkEmail?: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

function fieldErrorsFrom(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function resolveNext(raw: unknown): string {
  return safeNextPath(typeof raw === "string" ? raw : null) ?? TRIPS_HOME;
}

function appOrigin(): string {
  return getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

/** Creates an account. When email confirmation is on, returns checkEmail instead of signing in. */
export async function signUpAction(input: {
  displayName: string;
  email: string;
  password: string;
  next?: string;
}): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the form and try again.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const next = resolveNext(input.next);
  const client = await getServerClient();
  const { data, error } = await client.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { ok: false, message: messageForAuthError(error) };

  // No session means confirmation is required (or identities were empty for an existing email).
  if (!data.session) {
    return { ok: true, next, checkEmail: true };
  }
  return { ok: true, next };
}

/** Email and password sign-in. */
export async function signInAction(input: {
  email: string;
  password: string;
  next?: string;
}): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the form and try again.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const client = await getServerClient();
  const { error } = await client.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { ok: false, message: messageForAuthError(error) };
  return { ok: true, next: resolveNext(input.next) };
}

/** Sends a password-reset email that lands on /auth/callback then /reset-password. */
export async function forgotPasswordAction(input: { email: string }): Promise<AuthActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the form and try again.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const client = await getServerClient();
  const { error } = await client.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) return { ok: false, message: messageForAuthError(error) };
  return { ok: true, next: "/login", checkEmail: true };
}

/** Sets a new password for the recovery session established by /auth/callback. */
export async function resetPasswordAction(input: { password: string }): Promise<AuthActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the form and try again.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const client = await getServerClient();
  const { error } = await client.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: messageForAuthError(error) };
  return { ok: true, next: TRIPS_HOME };
}
