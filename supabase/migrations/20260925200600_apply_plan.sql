-- apply_plan, first version: merged slots on an initial plan. Writes a plan's options, attendees,
-- item statuses, and the plan card in one transaction, and marks the tool call succeeded.
-- Called only by the server (admin client) from applyPlan() in the itinerary feature.
--
-- payload:
--   trip_id, actor_member_id, run_id, tool_call_id, mode ('initial'),
--   slots: [{ item_id, member_ids: uuid[], options: [{ id, place_id, rank, price_cents, score,
--            score_breakdown, reasoning, source }] }],
--   card: the plan card payload (validated with Zod before the call),
--   result_summary: the ToolResult summary the model sees.
-- returns { card_message_id, changes: [], replayed: bool }

create function public.apply_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := (payload ->> 'trip_id')::uuid;
  v_actor uuid := (payload ->> 'actor_member_id')::uuid;
  v_run uuid := (payload ->> 'run_id')::uuid;
  v_tool_call_id text := payload ->> 'tool_call_id';
  v_call public.tool_calls%rowtype;
  v_slot jsonb;
  v_option jsonb;
  v_item uuid;
  v_status text;
  v_card uuid;
  v_output jsonb;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;

  if payload ->> 'mode' is distinct from 'initial' then
    raise exception 'invalid_input: this version of apply_plan handles initial plans only' using errcode = '22023';
  end if;

  -- Every row the payload names must belong to this trip.
  if not exists (select 1 from public.agent_runs r where r.id = v_run and r.trip_id = v_trip) then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload -> 'slots') s
    where not exists (
      select 1 from public.itinerary_items i where i.id = (s ->> 'item_id')::uuid and i.trip_id = v_trip
    )
  ) then
    raise exception 'not_permitted: an item belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload -> 'slots') s, jsonb_array_elements_text(s -> 'member_ids') mid
    where not exists (select 1 from public.trip_members m where m.id = mid::uuid and m.trip_id = v_trip)
  ) then
    raise exception 'not_permitted: a member belongs to another trip' using errcode = '42501';
  end if;

  -- Idempotency: a succeeded tool call returns its stored result and writes nothing.
  select * into v_call from public.tool_calls c
  where c.run_id = v_run and c.tool_call_id = v_tool_call_id
  for update;
  if not found then
    raise exception 'invalid_input: tool call % was not started', v_tool_call_id using errcode = '22023';
  end if;
  if v_call.status = 'succeeded' then
    return jsonb_build_object(
      'card_message_id', v_call.message_id,
      'changes', '[]'::jsonb,
      'replayed', true
    );
  end if;

  for v_slot in select * from jsonb_array_elements(payload -> 'slots') loop
    v_item := (v_slot ->> 'item_id')::uuid;

    select i.status into v_status from public.itinerary_items i where i.id = v_item for update;
    if v_status not in ('tbd', 'proposing') then
      raise exception 'conflict: item % is %, not open for planning', v_item, v_status;
    end if;

    for v_option in select * from jsonb_array_elements(v_slot -> 'options') loop
      insert into public.item_options (
        id, trip_id, item_id, place_id, rank, price_cents, score, score_breakdown, reasoning, source
      ) values (
        (v_option ->> 'id')::uuid,
        v_trip,
        v_item,
        (v_option ->> 'place_id')::uuid,
        (v_option ->> 'rank')::int,
        (v_option ->> 'price_cents')::int,
        (v_option ->> 'score')::numeric,
        coalesce(v_option -> 'score_breakdown', '{}'::jsonb),
        v_option ->> 'reasoning',
        v_option ->> 'source'
      );
    end loop;

    insert into public.item_attendees (item_id, member_id, trip_id)
    select v_item, mid::uuid, v_trip
    from jsonb_array_elements_text(v_slot -> 'member_ids') mid
    on conflict do nothing;

    -- Forward only: tbd -> proposing -> voting, each a conditional update.
    update public.itinerary_items set status = 'proposing' where id = v_item and status = 'tbd';
    update public.itinerary_items set status = 'voting' where id = v_item and status = 'proposing';
  end loop;

  insert into public.messages (trip_id, sender_type, kind, card_type, card_payload, agent_run_id)
  values (v_trip, 'agent', 'card', 'plan', payload -> 'card', v_run)
  returning id into v_card;

  v_output := jsonb_build_object('ok', true, 'summary', payload ->> 'result_summary', 'card_message_id', v_card);
  update public.tool_calls
  set status = 'succeeded', output = v_output, message_id = v_card
  where id = v_call.id and status = 'started';

  return jsonb_build_object('card_message_id', v_card, 'changes', '[]'::jsonb, 'replayed', false);
end;
$$;

revoke execute on function public.apply_plan(jsonb) from public, anon, authenticated;
