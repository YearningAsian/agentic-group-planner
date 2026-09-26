-- Migration 2: places and itinerary. The global places and routes cache, then the trip's items,
-- their options, attendees, votes, and each member's planning constraints.

-- ---------------------------------------------------------------------------------------------
-- places (global cache, no trip_id)
-- ---------------------------------------------------------------------------------------------

create table public.places (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google', 'mock', 'seed')),
  provider_place_id text not null,
  name text not null,
  category text not null check (category in ('food', 'activity', 'dessert', 'nightlife', 'lodging', 'other')),
  address text,
  lat double precision not null,
  lng double precision not null,
  price_level int check (price_level between 0 and 4),
  rating numeric(2, 1),
  phone text,
  photo_url text,
  hours jsonb,
  tags text[] not null default '{}',
  dietary_tags text[] not null default '{}'
    check (dietary_tags <@ array['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'nut_free', 'dairy_free']::text[]),
  raw jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  unique (provider, provider_place_id)
);

create index places_category_idx on public.places (category);
create index places_tags_idx on public.places using gin (tags);
create index places_seed_batch_idx on public.places (seed_batch);
create trigger places_set_updated_at before update on public.places
  for each row execute function public.set_updated_at();

alter table public.places enable row level security;
create policy "places: signed-in users read" on public.places for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- routes (global cache)
-- ---------------------------------------------------------------------------------------------

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  from_place_id uuid not null references public.places (id) on delete cascade,
  to_place_id uuid not null references public.places (id) on delete cascade,
  mode text not null check (mode in ('walking', 'driving')),
  geometry jsonb not null,
  duration_s int not null check (duration_s >= 0),
  distance_m int not null check (distance_m >= 0),
  provider text not null check (provider in ('ors', 'mock')),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  unique (from_place_id, to_place_id, mode)
);

create index routes_to_place_id_idx on public.routes (to_place_id);
create index routes_seed_batch_idx on public.routes (seed_batch);
create trigger routes_set_updated_at before update on public.routes
  for each row execute function public.set_updated_at();

alter table public.routes enable row level security;
create policy "routes: signed-in users read" on public.routes for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- itinerary_items
-- ---------------------------------------------------------------------------------------------

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  slot_key text not null,
  label text not null,
  category text not null check (category in ('food', 'activity', 'dessert', 'nightlife', 'lodging', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  position int not null,
  status text not null default 'tbd'
    check (status in ('tbd', 'proposing', 'voting', 'decided', 'booked', 'cancelled', 'superseded')),
  together boolean not null default false,
  pinned boolean not null default false,
  chosen_option_id uuid,
  area_label text,
  area_lat double precision,
  area_lng double precision,
  supersedes_item_id uuid references public.itinerary_items (id),
  -- The foreign key to agent_runs is added in migration 3, which creates that table.
  created_by_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  constraint itinerary_items_ends_after_starts check (ends_at > starts_at),
  constraint itinerary_items_area_all_or_none check (
    (area_label is null and area_lat is null and area_lng is null)
    or (area_label is not null and area_lat is not null and area_lng is not null)
  )
);

create index itinerary_items_trip_starts_idx on public.itinerary_items (trip_id, starts_at);
create index itinerary_items_trip_slot_idx on public.itinerary_items (trip_id, slot_key);
create index itinerary_items_chosen_option_id_idx on public.itinerary_items (chosen_option_id);
create index itinerary_items_supersedes_item_id_idx on public.itinerary_items (supersedes_item_id);
create index itinerary_items_created_by_run_id_idx on public.itinerary_items (created_by_run_id);
create index itinerary_items_seed_batch_idx on public.itinerary_items (seed_batch);
create trigger itinerary_items_set_updated_at before update on public.itinerary_items
  for each row execute function public.set_updated_at();
create trigger itinerary_items_enforce_transition before update of status on public.itinerary_items
  for each row execute function public.enforce_transition(
    'tbd:proposing', 'proposing:voting', 'voting:decided', 'decided:booked', 'tbd:booked',
    'tbd:cancelled', 'proposing:cancelled', 'voting:cancelled', 'decided:cancelled',
    'proposing:superseded', 'voting:superseded', 'decided:superseded'
  );

alter table public.itinerary_items enable row level security;
create policy "itinerary_items: members read" on public.itinerary_items
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- item_options
-- ---------------------------------------------------------------------------------------------

create table public.item_options (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id),
  place_id uuid not null references public.places (id),
  rank int not null check (rank >= 1),
  price_cents int not null check (price_cents >= 0),
  score numeric(6, 3) not null,
  score_breakdown jsonb not null,
  reasoning text,
  source text not null check (source in ('cp_sat', 'enumeration', 'mock', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  unique (item_id, rank),
  unique (item_id, place_id),
  -- The target of the votes composite foreign key.
  unique (id, item_id)
);

create index item_options_trip_id_idx on public.item_options (trip_id);
create index item_options_place_id_idx on public.item_options (place_id);
create index item_options_seed_batch_idx on public.item_options (seed_batch);
create trigger item_options_set_updated_at before update on public.item_options
  for each row execute function public.set_updated_at();

alter table public.item_options enable row level security;
create policy "item_options: members read" on public.item_options
  for select to authenticated using (public.is_trip_member(trip_id));

-- A circular reference (items point at their chosen option), so it's checked at commit.
alter table public.itinerary_items
  add constraint itinerary_items_chosen_option_id_fkey foreign key (chosen_option_id)
  references public.item_options (id) deferrable initially deferred;

-- ---------------------------------------------------------------------------------------------
-- item_attendees
-- ---------------------------------------------------------------------------------------------

create table public.item_attendees (
  item_id uuid not null references public.itinerary_items (id),
  member_id uuid not null references public.trip_members (id),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_at timestamptz not null default now(),
  seed_batch text,
  primary key (item_id, member_id)
);

create index item_attendees_member_id_idx on public.item_attendees (member_id);
create index item_attendees_trip_id_idx on public.item_attendees (trip_id);
create index item_attendees_seed_batch_idx on public.item_attendees (seed_batch);

alter table public.item_attendees enable row level security;
create policy "item_attendees: members read" on public.item_attendees
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------------------------------

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id),
  option_id uuid not null,
  member_id uuid not null references public.trip_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  unique (item_id, member_id),
  -- A vote can't point at another item's option.
  foreign key (option_id, item_id) references public.item_options (id, item_id)
);

create index votes_trip_id_idx on public.votes (trip_id);
create index votes_option_id_idx on public.votes (option_id);
create index votes_member_id_idx on public.votes (member_id);
create index votes_seed_batch_idx on public.votes (seed_batch);
create trigger votes_set_updated_at before update on public.votes
  for each row execute function public.set_updated_at();

alter table public.votes enable row level security;
create policy "votes: members read" on public.votes
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- member_constraints
-- ---------------------------------------------------------------------------------------------

create table public.member_constraints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  member_id uuid not null unique references public.trip_members (id),
  budget_cents int check (budget_cents >= 0),
  dietary text[] not null default '{}'
    check (dietary <@ array['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'nut_free', 'dairy_free']::text[]),
  interests text[] not null default '{}',
  notes text,
  set_by_member_id uuid references public.trip_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index member_constraints_trip_id_idx on public.member_constraints (trip_id);
create index member_constraints_set_by_member_id_idx on public.member_constraints (set_by_member_id);
create index member_constraints_seed_batch_idx on public.member_constraints (seed_batch);
create trigger member_constraints_set_updated_at before update on public.member_constraints
  for each row execute function public.set_updated_at();

alter table public.member_constraints enable row level security;

create policy "member_constraints: members read" on public.member_constraints
  for select to authenticated using (public.is_trip_member(trip_id));

-- A member edits their own constraints; the organizer edits anyone's, including placeholders'.
-- The member row must belong to the same trip either way.
create policy "member_constraints: owner or organizer inserts" on public.member_constraints
  for insert to authenticated with check (
    exists (
      select 1 from public.trip_members m
      where m.id = member_id and m.trip_id = member_constraints.trip_id
        and (m.profile_id = (select auth.uid()) or public.is_trip_organizer(m.trip_id))
    )
  );

create policy "member_constraints: owner or organizer updates" on public.member_constraints
  for update to authenticated
  using (
    exists (
      select 1 from public.trip_members m
      where m.id = member_id and m.trip_id = member_constraints.trip_id
        and (m.profile_id = (select auth.uid()) or public.is_trip_organizer(m.trip_id))
    )
  )
  with check (
    exists (
      select 1 from public.trip_members m
      where m.id = member_id and m.trip_id = member_constraints.trip_id
        and (m.profile_id = (select auth.uid()) or public.is_trip_organizer(m.trip_id))
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.itinerary_items, public.item_options, public.item_attendees, public.votes, public.member_constraints;
