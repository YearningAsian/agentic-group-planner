-- A short claim on a payer's share rows while the server calls the payments provider for them
-- (authorizing a hold, or capturing a placeholder's own hold after the booking). One conditional
-- update takes the claim, so of several concurrent approvals exactly one calls the provider, and
-- the provider never sees two in-flight requests with the same idempotency key. The claim lapses
-- on its own, so a crash mid-call never blocks a retry for long. Like agent_runs.lease_expires_at.

alter table public.payment_holds add column lease_expires_at timestamptz;
