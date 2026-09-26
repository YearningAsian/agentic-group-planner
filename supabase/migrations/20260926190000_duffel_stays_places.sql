-- Duffel rates are short-lived lodging offers. Their cached place keeps the rate and search
-- scope in raw; the provider distinguishes them from stable mock and seed places.
alter table public.places drop constraint places_provider_check;
alter table public.places add constraint places_provider_check
  check (provider in ('google', 'mock', 'seed', 'duffel_stays'));

-- Null-safe: a CHECK that evaluates to NULL passes, so a missing key must fail explicitly
-- rather than slip through.
alter table public.places add constraint places_duffel_rate_scope_check check (
  provider <> 'duffel_stays' or coalesce(
    category = 'lodging'
    and left(raw ->> 'rate_id', 4) = 'rat_'
    and raw ->> 'item_id' is not null
    and raw ->> 'trip_id' is not null
    and raw ->> 'check_in_date' is not null
    and raw ->> 'check_out_date' is not null
    and raw ->> 'expires_at' is not null
    and jsonb_typeof(raw -> 'guests') = 'number'
    and jsonb_typeof(raw -> 'total_cents') = 'number'
    and jsonb_typeof(raw -> 'price_cents') = 'number',
    false
  )
);

create index places_duffel_item_scope_idx on public.places ((raw ->> 'item_id'))
  where provider = 'duffel_stays';

-- A Duffel rate's place carries one trip's dates, party size, and item, so only that trip's
-- members may read it. Every other place stays readable to any signed-in user.
drop policy "places: signed-in users read" on public.places;
create policy "places: signed-in users read" on public.places for select to authenticated
  using (provider <> 'duffel_stays' or public.is_trip_member((raw ->> 'trip_id')::uuid));
