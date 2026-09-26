-- person_preferences: what the planner remembers about a person across trips (plan AI-217). One
-- row per profile. A user reads and edits only their own row; the agent reads and writes it with
-- the admin client, and only for the member who said it.
--
-- When a member with a profile joins a trip (claiming a lane, or the organizer's own row), their
-- remembered dietary needs and interests are merged into that trip's member_constraints, so the
-- optimizer's hard rules see them without anyone re-entering them. Budgets stay per trip.

create table public.person_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  dietary text[] not null default '{}'
    check (dietary <@ array['vegetarian', 'vegan', 'gluten_free', 'halal', 'kosher', 'nut_free', 'dairy_free']::text[]),
  interests text[] not null default '{}' check (pg_catalog.cardinality(interests) <= 20),
  -- [{ "text": "hates early starts", "trip_id": "…", "at": "2026-09-26T12:00:00Z" }], newest last.
  notes jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(notes) = 'array' and pg_catalog.jsonb_array_length(notes) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index person_preferences_seed_batch_idx on public.person_preferences (seed_batch);
create trigger person_preferences_set_updated_at before update on public.person_preferences
  for each row execute function public.set_updated_at();

alter table public.person_preferences enable row level security;

create policy "person_preferences: users read their own" on public.person_preferences
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "person_preferences: users insert their own" on public.person_preferences
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "person_preferences: users update their own" on public.person_preferences
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy "person_preferences: users delete their own" on public.person_preferences
  for delete to authenticated using (profile_id = (select auth.uid()));

-- Runs as the owner: it writes member_constraints for a row the caller may not edit directly (a
-- claim runs as the claimer, before they are a member). It touches only the joining member's row.
create function public.seed_member_constraints_from_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs public.person_preferences%rowtype;
begin
  select * into v_prefs from public.person_preferences p where p.profile_id = new.profile_id;
  if not found or (pg_catalog.cardinality(v_prefs.dietary) = 0 and pg_catalog.cardinality(v_prefs.interests) = 0) then
    return null;
  end if;

  insert into public.member_constraints as c (trip_id, member_id, dietary, interests, seed_batch)
  values (new.trip_id, new.id, v_prefs.dietary, v_prefs.interests, new.seed_batch)
  on conflict (member_id) do update
  set dietary = array(select distinct d from pg_catalog.unnest(c.dietary || excluded.dietary) d order by d),
      interests = array(select distinct i from pg_catalog.unnest(c.interests || excluded.interests) i order by i);
  return null;
end;
$$;

revoke execute on function public.seed_member_constraints_from_preferences() from public, anon, authenticated;

create trigger trip_members_seed_constraints_on_insert
  after insert on public.trip_members
  for each row
  when (new.status = 'joined' and new.profile_id is not null)
  execute function public.seed_member_constraints_from_preferences();

create trigger trip_members_seed_constraints_on_join
  after update of status, profile_id on public.trip_members
  for each row
  when (new.status = 'joined' and new.profile_id is not null
        and (old.status is distinct from 'joined' or old.profile_id is distinct from new.profile_id))
  execute function public.seed_member_constraints_from_preferences();
