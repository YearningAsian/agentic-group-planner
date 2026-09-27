-- Shared trip-draft document. Every signed-in member reads and writes this one row, so a
-- change made as one person shows up for the others. Realtime publishes the row; clients
-- refetch and do not treat the payload as state. Home address stays on studio_state.

create table public.studio_board (
  id text primary key,
  active_trip_id text,
  trips jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint studio_board_singleton check (id = 'demo')
);

insert into public.studio_board (id) values ('demo');

create trigger studio_board_set_updated_at before update on public.studio_board
  for each row execute function public.set_updated_at();

alter table public.studio_board enable row level security;

create policy "studio_board: signed-in users read" on public.studio_board
  for select to authenticated using ((select auth.uid()) is not null);

create policy "studio_board: signed-in users update" on public.studio_board
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

alter publication supabase_realtime add table public.studio_board;
