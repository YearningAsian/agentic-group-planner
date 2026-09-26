-- Retain the merchant quote selected for finalization so a retry uses the same booking
-- idempotency key and quote after a partial capture. A first-time price change cancels the
-- unbooked mandate and frees the approvals for a new proposal.
alter table public.mandates
  add column booking_quote_id text;

alter table public.mandates
  drop constraint mandates_cancel_reason_check;

alter table public.mandates
  add constraint mandates_cancel_reason_check
  check (cancel_reason in ('organizer', 'expired', 'booking_failed', 'price_above_cap', 'price_changed'));

comment on column public.mandates.booking_quote_id is
  'Fresh same-price quote persisted before booking; reused by retries after a booking or partial capture.';
