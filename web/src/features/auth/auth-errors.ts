/** Maps a Supabase Auth error to a short, user-facing message. */
export function messageForAuthError(error: {
  code?: string;
  status?: number;
  message?: string;
}): string {
  const code = error.code ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(error.message ?? "")) {
    return "Wrong email or password.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(error.message ?? "")) {
    return "Confirm your email before logging in. Check your inbox for the link.";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    error.status === 429 ||
    /rate limit/i.test(error.message ?? "")
  ) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "user_already_exists" || /already registered/i.test(error.message ?? "")) {
    return "An account with that email already exists. Log in instead.";
  }
  if (code === "weak_password") {
    return "Use at least 10 characters for your password.";
  }
  return "Something went wrong. Try again.";
}
