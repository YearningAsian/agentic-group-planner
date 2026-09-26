-- Migration 4: commerce, calls, and webhooks. Mandates and their share rows, bookings, price
-- changes, restaurant calls, and the webhook ledger.

-- ---------------------------------------------------------------------------------------------
-- mandates
-- ---------------------------------------------------------------------------------------------

create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id),
  option_id uuid not null references public.item_options (id),
  merchant text not null,
  title text not null,
  quote_id text not null,
  quote_cents int not null check (quote_cents >= 0),
  cap_cents int not null,
  final_cents int check (final_cents >= 0),
  currency text not null,
  status text not null default 'open'
    check (status in ('open', 'partially_declined', 'authorized', 'captured', 'cancelled', 'failed')),
  expires_at timestamptz not null,
  cancel_reason text check (cancel_reason in ('organizer', 'expired', 'booking_failed', 'price_above_cap')),
  supersedes_mandate_id uuid references public.mandates (id),
  proposed_by_run_id uuid references public.agent_runs (id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  constraint mandates_cap_covers_quote check (cap_cents >= quote_cents)
);

create index mandates_trip_id_idx on public.mandates (trip_id);
create index mandates_item_id_idx on public.mandates (item_id);
create index mandates_option_id_idx on public.mandates (option_id);
create index mandates_supersedes_mandate_id_idx on public.mandates (supersedes_mandate_id);
create index mandates_proposed_by_run_id_idx on public.mandates (proposed_by_run_id);
create index mandates_seed_batch_idx on public.mandates (seed_batch);
-- One live mandate per item, so a retried propose_purchase can't ask for money twice.
create unique index mandates_one_live_per_item_key on public.mandates (item_id)
  where status in ('open', 'partially_declined', 'authorized');
create trigger mandates_set_updated_at before update on public.mandates
  for each row execute function public.set_updated_at();
create trigger mandates_enforce_transition before update of status on public.mandates
  for each row execute function public.enforce_transition(
    'open:authorized', 'open:partially_declined', 'partially_declined:authorized', 'open:cancelled',
    'partially_declined:cancelled', 'authorized:captured', 'authorized:cancelled', 'authorized:failed'
  );

alter table public.mandates enable row level security;
create policy "mandates: members read" on public.mandates
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- payment_holds: one row per share and the hold that may pay it
-- ---------------------------------------------------------------------------------------------

create table public.payment_holds (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  mandate_id uuid not null references public.mandates (id),
  payer_member_id uuid references public.trip_members (id),
  share_member_id uuid not null references public.trip_members (id),
  kind text not null check (kind in ('own', 'fronted')),
  share_cents int not null check (share_cents >= 0),
  cap_cents int not null check (cap_cents >= share_cents),
  captured_cents int check (captured_cents >= 0),
  refunded_cents int check (refunded_cents >= 0),
  -- The organizer's own and fronted rows share one PaymentIntent, so this repeats across rows.
  stripe_payment_intent_id text,
  status text not null check (status in (
    'awaiting_member', 'pending', 'authorized', 'captured', 'refunded', 'released', 'declined', 'failed', 'expired'
  )),
  pays_share boolean,
  decline_code text,
  authorized_at timestamptz,
  captured_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  unique (mandate_id, share_member_id, kind),
  -- A placeholder's own share has no payer until they claim; every other live row has one.
  constraint payment_holds_payer_matches_status check (
    (status <> 'awaiting_member' or payer_member_id is null)
    and (payer_member_id is not null or status in ('awaiting_member', 'released'))
  )
);

create index payment_holds_trip_id_idx on public.payment_holds (trip_id);
create index payment_holds_payer_member_id_idx on public.payment_holds (payer_member_id);
create index payment_holds_share_member_id_idx on public.payment_holds (share_member_id);
create index payment_holds_stripe_payment_intent_id_idx on public.payment_holds (stripe_payment_intent_id);
create index payment_holds_seed_batch_idx on public.payment_holds (seed_batch);
create trigger payment_holds_set_updated_at before update on public.payment_holds
  for each row execute function public.set_updated_at();
create trigger payment_holds_enforce_transition before update of status on public.payment_holds
  for each row execute function public.enforce_transition(
    'awaiting_member:pending', 'pending:authorized', 'pending:declined', 'pending:failed',
    'awaiting_member:released', 'pending:released', 'authorized:captured', 'authorized:released',
    'authorized:expired', 'captured:refunded'
  );

alter table public.payment_holds enable row level security;
-- Approvals are visible to the group by design.
create policy "payment_holds: members read" on public.payment_holds
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------------------------

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id),
  place_id uuid not null references public.places (id),
  to_number text not null check (to_number ~ '^\+[1-9][0-9]{7,14}$'),
  provider text not null check (provider in ('elevenlabs', 'mock')),
  conversation_id text unique,
  provider_call_sid text,
  request jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'dialing', 'in_progress', 'completed', 'failed', 'no_answer')),
  outcome jsonb,
  summary text,
  failure_reason text,
  started_at timestamptz,
  ended_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index calls_trip_id_idx on public.calls (trip_id);
create index calls_item_id_idx on public.calls (item_id);
create index calls_place_id_idx on public.calls (place_id);
create index calls_seed_batch_idx on public.calls (seed_batch);
-- One active call per item: a retried call_restaurant can't dial twice.
create unique index calls_one_active_per_item_key on public.calls (item_id)
  where status in ('queued', 'dialing', 'in_progress');
create trigger calls_set_updated_at before update on public.calls
  for each row execute function public.set_updated_at();
create trigger calls_enforce_transition before update of status on public.calls
  for each row execute function public.enforce_transition(
    'queued:dialing', 'queued:failed', 'dialing:in_progress', 'dialing:completed', 'dialing:no_answer',
    'dialing:failed', 'in_progress:completed', 'in_progress:failed'
  );

alter table public.calls enable row level security;
create policy "calls: members read" on public.calls
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id),
  option_id uuid references public.item_options (id),
  mandate_id uuid references public.mandates (id),
  call_id uuid references public.calls (id),
  provider text not null check (provider in ('mock_merchant', 'voice_reservation', 'duffel_stays', 'stays_mock')),
  provider_ref text,
  confirmation_code text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'cancelled')),
  total_cents int check (total_cents >= 0),
  currency text not null,
  payer text not null check (payer in ('split', 'organizer', 'pay_at_venue')),
  details jsonb not null,
  confirmed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text
);

create index bookings_trip_id_idx on public.bookings (trip_id);
create index bookings_item_id_idx on public.bookings (item_id);
create index bookings_option_id_idx on public.bookings (option_id);
create index bookings_seed_batch_idx on public.bookings (seed_batch);
create unique index bookings_mandate_id_key on public.bookings (mandate_id) where mandate_id is not null;
create unique index bookings_call_id_key on public.bookings (call_id) where call_id is not null;
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger bookings_enforce_transition before update of status on public.bookings
  for each row execute function public.enforce_transition('pending:confirmed', 'pending:failed', 'confirmed:cancelled');

alter table public.bookings enable row level security;
create policy "bookings: members read" on public.bookings
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- price_changes
-- ---------------------------------------------------------------------------------------------

create table public.price_changes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  mandate_id uuid references public.mandates (id),
  booking_id uuid references public.bookings (id),
  old_cents int not null check (old_cents >= 0),
  new_cents int not null check (new_cents >= 0),
  action text not null check (action in ('auto_captured', 'auto_captured_lower', 'reapproval_requested', 'notified')),
  new_mandate_id uuid references public.mandates (id),
  source text not null check (source in ('merchant', 'demo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  constraint price_changes_has_subject check (mandate_id is not null or booking_id is not null)
);

create index price_changes_trip_id_idx on public.price_changes (trip_id);
create index price_changes_mandate_id_idx on public.price_changes (mandate_id);
create index price_changes_booking_id_idx on public.price_changes (booking_id);
create index price_changes_new_mandate_id_idx on public.price_changes (new_mandate_id);
create index price_changes_seed_batch_idx on public.price_changes (seed_batch);
create trigger price_changes_set_updated_at before update on public.price_changes
  for each row execute function public.set_updated_at();

alter table public.price_changes enable row level security;
create policy "price_changes: members read" on public.price_changes
  for select to authenticated using (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------------------------
-- webhook_events: the record-first ledger. RLS on with no policies, so clients can't read it.
-- ---------------------------------------------------------------------------------------------

create table public.webhook_events (
  provider text not null check (provider in ('stripe', 'elevenlabs', 'elevenlabs_tool')),
  event_id text not null,
  type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts int not null default 1 check (attempts >= 1),
  payload jsonb,
  error text,
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_batch text,
  primary key (provider, event_id)
);

create index webhook_events_seed_batch_idx on public.webhook_events (seed_batch);
create trigger webhook_events_set_updated_at before update on public.webhook_events
  for each row execute function public.set_updated_at();
-- A failed event is retried by the provider, so failed -> processed is allowed (§7.2 step 3).
create trigger webhook_events_enforce_transition before update of status on public.webhook_events
  for each row execute function public.enforce_transition(
    'received:processed', 'received:ignored', 'received:failed', 'failed:processed', 'failed:ignored'
  );

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Foreign keys into this migration's tables
-- ---------------------------------------------------------------------------------------------

alter table public.agent_runs
  add constraint agent_runs_trigger_call_id_fkey foreign key (trigger_call_id) references public.calls (id);

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.mandates, public.payment_holds, public.bookings, public.price_changes, public.calls;
