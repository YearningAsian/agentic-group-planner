-- Duffel rates are short-lived lodging offers. Their cached place keeps the rate and search
-- scope in raw; the provider distinguishes them from stable mock and seed places.
alter table public.places drop constraint places_provider_check;
alter table public.places add constraint places_provider_check
  check (provider in ('google', 'mock', 'seed', 'duffel_stays'));

alter table public.places add constraint places_duffel_rate_scope_check check (
  provider <> 'duffel_stays' or (
    category = 'lodging'
    and left(raw ->> 'rate_id', 4) = 'rat_'
    and raw ->> 'item_id' is not null
    and raw ->> 'check_in_date' is not null
    and raw ->> 'check_out_date' is not null
    and raw ->> 'guests' is not null
    and raw ->> 'expires_at' is not null
    and raw ->> 'total_cents' is not null
    and raw ->> 'price_cents' is not null
  )
);

create index places_duffel_item_scope_idx on public.places ((raw ->> 'item_id'))
  where provider = 'duffel_stays';
