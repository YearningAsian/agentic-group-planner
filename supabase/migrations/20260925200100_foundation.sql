-- Migration 1: foundation. Shared trigger functions, profiles, trips, members, and the membership
-- helpers that every row-level security policy uses.

-- ---------------------------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Statuses only move forward. Each table's trigger passes its allowed 'from:to' pairs as
-- arguments; any other change raises, so a bad write fails loudly instead of rewinding state.
-- Handlers still use conditional updates, so duplicate events match zero rows and never get here.
create function public.enforce_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if (old.status || ':' || new.status) = any (tg_argv) then
    return new;
  end if;
  raise exception 'invalid_transition: % -> % on %', old.status, new.status, tg_table_name
    using errcode = '23514';
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_transition() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  stripe_customer_id text unique,
  default_payment_method_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index profiles_seed_batch_idx on public.profiles (seed_batch);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: users read their own row" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- Every auth user gets a profile. Seeded users carry their batch in user_metadata, so
-- `reset:demo` can find them.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, seed_batch)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Guest'),
    nullif(new.raw_user_meta_data ->> 'seed_batch', '')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------------------------

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) = 11),
  title text not null,
  city text not null,
  trip_date date not null,
  timezone text not null default 'America/New_York',
  currency text not null default 'usd',
  status text not null default 'planning' check (status in ('planning', 'active', 'completed')),
  organizer_profile_id uuid not null references public.profiles (id) on delete restrict,
  organizer_attending boolean not null default true,
  price_threshold_percent int not null default 110 check (price_threshold_percent between 100 and 125),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index trips_organizer_profile_id_idx on public.trips (organizer_profile_id);
create index trips_status_idx on public.trips (status);
create index trips_seed_batch_idx on public.trips (seed_batch);
create trigger trips_set_updated_at before update on public.trips
  for each row execute function public.set_updated_at();
create trigger trips_enforce_transition before update of status on public.trips
  for each row execute function public.enforce_transition('planning:active', 'planning:completed', 'active:completed');

alter table public.trips enable row level security;

-- ---------------------------------------------------------------------------------------------
-- trip_members
-- ---------------------------------------------------------------------------------------------

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  role text not null default 'member' check (role in ('organizer', 'member')),
  status text not null default 'placeholder' check (status in ('placeholder', 'invited', 'joined')),
  invite_token text unique,
  claimed_at timestamptz,
  lane_color text not null check (lane_color in ('lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-5', 'lane-6')),
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  constraint trip_members_status_matches_profile check (
    (status = 'joined' and profile_id is not null)
    or (status in ('placeholder', 'invited') and profile_id is null)
  )
);

create index trip_members_trip_id_idx on public.trip_members (trip_id);
create index trip_members_profile_id_idx on public.trip_members (profile_id);
create index trip_members_seed_batch_idx on public.trip_members (seed_batch);
create unique index trip_members_trip_profile_key on public.trip_members (trip_id, profile_id)
  where profile_id is not null;
create unique index trip_members_one_organizer_key on public.trip_members (trip_id)
  where role = 'organizer';
create trigger trip_members_set_updated_at before update on public.trip_members
  for each row execute function public.set_updated_at();
create trigger trip_members_enforce_transition before update of status on public.trip_members
  for each row execute function public.enforce_transition('placeholder:invited', 'placeholder:joined', 'invited:joined');

alter table public.trip_members enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Membership helpers. Security definer so policies on trip_members can call them without
-- recursing into trip_members' own policies.
-- ---------------------------------------------------------------------------------------------

create function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.profile_id = (select auth.uid()) and m.status = 'joined'
  );
$$;

create function public.is_trip_organizer(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.profile_id = (select auth.uid()) and m.status = 'joined'
      and m.role = 'organizer'
  );
$$;

revoke execute on function public.is_trip_member(uuid) from public, anon;
revoke execute on function public.is_trip_organizer(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_organizer(uuid) to authenticated;

create policy "trips: members read" on public.trips
  for select to authenticated using (public.is_trip_member(id));

create policy "trip_members: members read" on public.trip_members
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table public.trips, public.trip_members;
