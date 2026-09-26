-- The journey pivot (design §11.6) dropped voting, the restaurant call, and the recap. This drops
-- their tables and columns and narrows each enum CHECK to the design §3.1 values, so the schema
-- matches @agp/shared/enums.ts again. Nothing writes these: no function, route, or policy used
-- them, and no hosted project has these tables yet, so no data is lost.

-- No code path ever wrote the removed values, so there is nothing to convert. If a local database
-- somehow holds one, stop with a message that says what to do instead of a bare CHECK violation.
do $$
begin
  if exists (select 1 from public.agent_runs where trigger = 'call_completed')
    or exists (select 1 from public.messages where card_type in ('call_status', 'recap'))
    or exists (select 1 from public.tool_calls where tool_name in ('call_restaurant', 'generate_recap'))
    or exists (select 1 from public.bookings where provider = 'voice_reservation')
    or exists (select 1 from public.webhook_events where provider in ('elevenlabs', 'elevenlabs_tool'))
  then
    raise exception 'journey_pivot_cleanup: rows use a value the pivot removed; run `supabase db reset` locally';
  end if;
end;
$$;

-- Restaurant calls: the column that pointed a run or a booking at a call, then the table.
alter table public.agent_runs drop column trigger_call_id;
alter table public.bookings drop column call_id;
drop table public.calls;

-- Voting: items now move voting → decided through the organizer's lock or an explicit
-- confirmation in chat (design §4.1). item_options keeps its (id, item_id) unique key; it's harmless.
drop table public.votes;

-- Each inline CHECK keeps the name Postgres gave it, so later migrations can find it the same way.
alter table public.agent_runs drop constraint agent_runs_trigger_check;
alter table public.agent_runs
  add constraint agent_runs_trigger_check check (trigger in ('mention', 'price_change', 'demo'));

alter table public.messages drop constraint messages_card_type_check;
alter table public.messages
  add constraint messages_card_type_check check (card_type in (
    'place_list', 'plan', 'itinerary_change', 'summary', 'approval', 'booking_confirmed',
    'price_change', 'member_joined', 'error'
  ));

alter table public.tool_calls drop constraint tool_calls_tool_name_check;
alter table public.tool_calls
  add constraint tool_calls_tool_name_check check (tool_name in (
    'search_places', 'plan_day', 'update_item', 'summarize', 'propose_purchase'
  ));

alter table public.bookings drop constraint bookings_provider_check;
alter table public.bookings
  add constraint bookings_provider_check check (provider in ('mock_merchant', 'duffel_stays', 'stays_mock'));

alter table public.webhook_events drop constraint webhook_events_provider_check;
alter table public.webhook_events
  add constraint webhook_events_provider_check check (provider in ('stripe'));
