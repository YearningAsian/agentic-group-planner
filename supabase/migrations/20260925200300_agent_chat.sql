-- Migration 3: agent and chat. Runs, messages (including cards), and tool calls, then the foreign
-- keys that point into them from earlier tables.

-- ---------------------------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  trigger text not null check (trigger in ('mention', 'call_completed', 'price_change', 'demo')),
  -- Foreign keys added below (messages) and in migration 4 (calls).
  trigger_message_id uuid unique,
  trigger_call_id uuid unique,
  requester_member_id uuid references public.trip_members (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  lease_expires_at timestamptz,
  provider text not null check (provider in ('xai', 'google', 'mock')),
  model text not null,
  replayed boolean not null default false,
  step_count int not null default 0,
  handles jsonb not null default '{}',
  usage jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index agent_runs_trip_created_idx on public.agent_runs (trip_id, created_at);
create index agent_runs_requester_member_id_idx on public.agent_runs (requester_member_id);
create index agent_runs_seed_batch_idx on public.agent_runs (seed_batch);
-- Only one run per trip is ever running; the runner's claim relies on this.
create unique index agent_runs_one_running_per_trip_key on public.agent_runs (trip_id) where status = 'running';
create trigger agent_runs_set_updated_at before update on public.agent_runs
  for each row execute function public.set_updated_at();
create trigger agent_runs_enforce_transition before update of status on public.agent_runs
  for each row execute function public.enforce_transition(
    'queued:running', 'queued:failed', 'running:succeeded', 'running:failed'
  );

alter table public.agent_runs enable row level security;
-- The agent trace is visible to members by design.
create policy "agent_runs: members read" on public.agent_runs
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- messages (text and cards)
-- ---------------------------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  sender_type text not null check (sender_type in ('member', 'agent', 'system')),
  sender_member_id uuid references public.trip_members (id),
  kind text not null check (kind in ('text', 'card')),
  body text check (char_length(body) <= 4000),
  card_type text check (card_type in (
    'place_list', 'plan', 'itinerary_change', 'summary', 'approval', 'call_status', 'recap',
    'booking_confirmed', 'price_change', 'member_joined', 'error'
  )),
  card_payload jsonb,
  item_id uuid references public.itinerary_items (id),
  client_id uuid unique,
  mentions_agent boolean not null default false,
  agent_run_id uuid references public.agent_runs (id),
  reply_to_message_id uuid references public.messages (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  constraint messages_sender_member_matches_type check ((sender_member_id is not null) = (sender_type = 'member')),
  constraint messages_card_type_matches_kind check ((card_type is not null) = (kind = 'card'))
);

create index messages_trip_created_idx on public.messages (trip_id, created_at desc);
create index messages_sender_member_id_idx on public.messages (sender_member_id);
create index messages_item_id_idx on public.messages (item_id);
create index messages_agent_run_id_idx on public.messages (agent_run_id);
create index messages_reply_to_message_id_idx on public.messages (reply_to_message_id);
create index messages_seed_batch_idx on public.messages (seed_batch);
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

alter table public.messages enable row level security;

create policy "messages: members read" on public.messages
  for select to authenticated using (public.is_trip_member(trip_id));

-- Users post plain text as themselves. Cards, agent and system messages, and run links are
-- written by the server.
create policy "messages: members post their own text" on public.messages
  for insert to authenticated with check (
    sender_type = 'member'
    and kind = 'text'
    and card_type is null
    and card_payload is null
    and agent_run_id is null
    and exists (
      select 1 from public.trip_members m
      where m.id = sender_member_id and m.trip_id = messages.trip_id
        and m.profile_id = (select auth.uid()) and m.status = 'joined'
    )
  );

alter table public.agent_runs
  add constraint agent_runs_trigger_message_id_fkey foreign key (trigger_message_id) references public.messages (id);

-- ---------------------------------------------------------------------------------------------
-- tool_calls
-- ---------------------------------------------------------------------------------------------

create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  run_id uuid not null references public.agent_runs (id),
  tool_call_id text not null,
  tool_name text not null check (tool_name in (
    'search_places', 'plan_day', 'update_item', 'summarize', 'propose_purchase', 'call_restaurant', 'generate_recap'
  )),
  input jsonb not null,
  output jsonb,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  error jsonb,
  duration_ms int check (duration_ms >= 0),
  message_id uuid references public.messages (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  -- A tool call executes once per run; a retry finds the stored result.
  unique (run_id, tool_call_id)
);

create index tool_calls_trip_id_idx on public.tool_calls (trip_id);
create index tool_calls_message_id_idx on public.tool_calls (message_id);
create index tool_calls_seed_batch_idx on public.tool_calls (seed_batch);
create trigger tool_calls_set_updated_at before update on public.tool_calls
  for each row execute function public.set_updated_at();
create trigger tool_calls_enforce_transition before update of status on public.tool_calls
  for each row execute function public.enforce_transition('started:succeeded', 'started:failed');

alter table public.tool_calls enable row level security;
create policy "tool_calls: members read" on public.tool_calls
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- Foreign keys into this migration's tables
-- ---------------------------------------------------------------------------------------------

alter table public.itinerary_items
  add constraint itinerary_items_created_by_run_id_fkey foreign key (created_by_run_id) references public.agent_runs (id);

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages, public.agent_runs, public.tool_calls;
