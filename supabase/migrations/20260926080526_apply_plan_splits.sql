-- apply_plan with splits (AI-209). Replaces the first version (20260925200600_apply_plan.sql) in
-- place: a split slot's second group gets a sibling item with the same slot_key, label, category,
-- and times, and its own options and attendees. Everything else is unchanged: one transaction
-- writes the options, attendees, forward-only item statuses, and the plan card, and marks the
-- tool call succeeded. Called only by the server (admin client) from applyPlan().
--
-- payload:
--   trip_id, actor_member_id, run_id, tool_call_id, mode ('initial'),
--   slots: [{ item_id, sibling_of?, member_ids: uuid[], options: [{ id, place_id, rank,
--            price_cents, score, score_breakdown, reasoning, source }] }]
--     An entry with sibling_of creates item_id as a new item in sibling_of's slot.
--   card: the plan card payload (validated with Zod before the call),
--   result_summary: the ToolResult summary the model sees,
--   result_handles: optional { handle: label } for the rows this call creates.
-- returns { card_message_id, changes: [], replayed: bool, created_item_ids: uuid[] }, plus the
-- stored ToolResult as `result` when the call already succeeded (replayed).

create or replace function public.apply_plan(payload jsonb)
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
  v_sibling_of uuid;
  v_status text;
  v_together boolean;
  v_card uuid;
  v_output jsonb;
  v_created uuid[] := '{}';
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

  -- Every row the payload names must belong to this trip. A new sibling is checked through the
  -- item it splits from.
  if not exists (select 1 from public.agent_runs r where r.id = v_run and r.trip_id = v_trip) then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload -> 'slots') s
    where not exists (
      select 1 from public.itinerary_items i
      where i.id = coalesce((s ->> 'sibling_of')::uuid, (s ->> 'item_id')::uuid) and i.trip_id = v_trip
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
  -- A member goes with one group per slot.
  if exists (
    select 1
    from jsonb_array_elements(payload -> 'slots') s
    join public.itinerary_items i on i.id = coalesce((s ->> 'sibling_of')::uuid, (s ->> 'item_id')::uuid)
    cross join lateral jsonb_array_elements_text(s -> 'member_ids') mid
    group by i.slot_key, mid
    having count(*) > 1
  ) then
    raise exception 'invalid_input: a member is in two groups of one slot' using errcode = '22023';
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
      'replayed', true,
      'created_item_ids', '[]'::jsonb,
      'result', v_call.output
    );
  end if;

  -- Check every slot before writing any: the loop below moves items forward, so a split's second
  -- group would otherwise find its original item already in voting.
  for v_slot in select * from jsonb_array_elements(payload -> 'slots') loop
    v_item := (v_slot ->> 'item_id')::uuid;
    v_sibling_of := (v_slot ->> 'sibling_of')::uuid;

    -- The item being planned, or the one a new sibling splits from, must still be open.
    select i.status, i.together into v_status, v_together
    from public.itinerary_items i where i.id = coalesce(v_sibling_of, v_item)
    for update;
    if v_status not in ('tbd', 'proposing') then
      raise exception 'conflict: item % is %, not open for planning', coalesce(v_sibling_of, v_item), v_status;
    end if;
    if v_sibling_of is not null then
      if v_together then
        raise exception 'invalid_input: item % is a together slot, so it can''t split', v_sibling_of using errcode = '22023';
      end if;
      if exists (select 1 from public.itinerary_items i where i.id = v_item) then
        raise exception 'invalid_input: the new sibling item % already exists', v_item using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_slot in select * from jsonb_array_elements(payload -> 'slots') loop
    v_item := (v_slot ->> 'item_id')::uuid;
    v_sibling_of := (v_slot ->> 'sibling_of')::uuid;

    if v_sibling_of is not null then
      -- The second group's lane: the same slot, key, and times, next in position, in tbd.
      insert into public.itinerary_items (
        id, trip_id, slot_key, label, category, starts_at, ends_at, position, together,
        area_label, area_lat, area_lng, created_by_run_id, seed_batch
      )
      select
        v_item, i.trip_id, i.slot_key, i.label, i.category, i.starts_at, i.ends_at,
        (select coalesce(max(o.position), 0) + 1 from public.itinerary_items o
         where o.trip_id = i.trip_id and o.slot_key = i.slot_key),
        false, i.area_label, i.area_lat, i.area_lng, v_run, i.seed_batch
      from public.itinerary_items i
      where i.id = v_sibling_of;
      v_created := v_created || v_item;
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

  -- Stored as the model saw it, handles included, so a replayed call returns the same result.
  v_output := jsonb_build_object('ok', true, 'summary', payload ->> 'result_summary', 'card_message_id', v_card)
    || case
         when jsonb_typeof(payload -> 'result_handles') = 'object' then jsonb_build_object('handles', payload -> 'result_handles')
         else '{}'::jsonb
       end;
  update public.tool_calls
  set status = 'succeeded', output = v_output, message_id = v_card
  where id = v_call.id and status = 'started';

  return jsonb_build_object(
    'card_message_id', v_card,
    'changes', '[]'::jsonb,
    'replayed', false,
    'created_item_ids', to_jsonb(v_created)
  );
end;
$$;

revoke execute on function public.apply_plan(jsonb) from public, anon, authenticated;
