-- Public trip addresses are random and independent of internal UUIDs. Claims outlive deleted trips
-- so an old public URL cannot later resolve to a different trip; the same seeded UUID may reclaim
-- its fixed slug after a demo reset.

create table public.trip_slug_claims (
  slug text primary key check (slug ~ '^[A-Za-z0-9_-]{11}$'),
  trip_id uuid not null,
  created_at timestamptz not null default now()
);

insert into public.trip_slug_claims (slug, trip_id)
select slug, id from public.trips;

alter table public.trip_slug_claims enable row level security;
revoke all on public.trip_slug_claims from anon, authenticated;

create function public.generate_trip_slug()
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.translate(
    pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(8), 'base64'), '='),
    '+/', '-_'
  );
$$;

alter table public.trips alter column slug set default public.generate_trip_slug();
alter table public.trips add constraint trips_slug_base64url_check
  check (slug ~ '^[A-Za-z0-9_-]{11}$');

create function public.claim_trip_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_by uuid;
  v_attempt integer := 0;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'trip slug is immutable' using errcode = '23514';
    end if;
    return new;
  end if;

  loop
    begin
      insert into public.trip_slug_claims (slug, trip_id) values (new.slug, new.id);
      return new;
    exception when unique_violation then
      -- A concurrent insert is settled by the claims PK before this query runs.
      select trip_id into v_claimed_by from public.trip_slug_claims where slug = new.slug;
      if v_claimed_by = new.id then return new; end if;
      v_attempt := v_attempt + 1;
      if v_attempt >= 32 then
        raise exception 'could not allocate a unique trip slug' using errcode = '23505';
      end if;
      new.slug := public.generate_trip_slug();
    end;
  end loop;
end;
$$;

create trigger trips_claim_slug before insert or update of slug on public.trips
  for each row execute function public.claim_trip_slug();

revoke execute on function public.claim_trip_slug() from public, anon, authenticated;
