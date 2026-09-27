-- Record a confirmed merchant booking before capturing any payer. A retry must not rebook an
-- expired quote after one PaymentIntent was captured, even if the server process restarted.
alter table public.mandates
  add column booking_provider_ref text,
  add column booking_confirmation_code text;

comment on column public.mandates.booking_provider_ref is
  'Confirmed merchant reference persisted before any PaymentIntent capture; retries reuse it.';
comment on column public.mandates.booking_confirmation_code is
  'Confirmation code paired with booking_provider_ref for a retry after partial capture.';
