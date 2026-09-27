-- The trip-draft screens used to keep the whole studio in the browser. This row is that
-- document, owned by the signed-in profile, so a reload and a second browser see the same trips.

create table public.studio_state (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  active_trip_id text,
  trips jsonb not null default '[]'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger studio_state_set_updated_at before update on public.studio_state
  for each row execute function public.set_updated_at();

alter table public.studio_state enable row level security;

create policy "studio_state: owner reads" on public.studio_state
  for select to authenticated using (profile_id = (select auth.uid()));

create policy "studio_state: owner inserts" on public.studio_state
  for insert to authenticated with check (profile_id = (select auth.uid()));

create policy "studio_state: owner updates" on public.studio_state
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "studio_state: owner deletes" on public.studio_state
  for delete to authenticated using (profile_id = (select auth.uid()));
