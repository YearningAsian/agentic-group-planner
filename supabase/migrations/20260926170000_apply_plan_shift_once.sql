-- A replan's time shift happens once (AI-210 review). apply_plan never moves a booked item, so its
-- confirmed start keeps differing from its slot's, and every later replan used to shift the slot
-- before it again. Each item now records the minutes it has been shifted (shifted_min); the server
-- asks only for the rest of the shift, and copies of an item keep the count.
--
-- apply_plan is otherwise unchanged from 20260926140000_apply_plan_replan.sql, except that
-- time_shifts entries carry delta_min: [{ item_id, starts_at, ends_at, delta_min }], added to shifted_min.

alter table public.itinerary_items add column shifted_min int not null default 0;
comment on column public.itinerary_items.shifted_min is
  'Minutes this item has been moved by replan time shifts, so a shift is applied once.';

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
  v_mode text := payload ->> 'mode';
  v_supersede uuid[] := array(select jsonb_array_elements_text(coalesce(payload -> 'supersede_item_ids', '[]'::jsonb))::uuid);
  v_shifts jsonb := coalesce(payload -> 'time_shifts', '[]'::jsonb);
  v_changes jsonb := coalesce(payload -> 'changes', '[]'::jsonb);
  v_call public.tool_calls%rowtype;
  v_slot jsonb;
  v_option jsonb;
  v_item uuid;
  v_sibling_of uuid;
  v_from uuid;
  v_status text;
  v_together boolean;
  v_card uuid;
  v_output jsonb;
  v_created uuid[] := '{}';
  v_template_used uuid[] := '{}';
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;

  if v_mode is null or v_mode not in ('initial', 'replan') then
    raise exception 'invalid_input: apply_plan mode must be initial or replan' using errcode = '22023';
  end if;
  if v_mode = 'initial' and (
    cardinality(v_supersede) > 0 or jsonb_array_length(v_shifts) > 0
    or exists (select 1 from jsonb_array_elements(payload -> 'slots') s where s ? 'from_item_id')
  ) then
    raise exception 'invalid_input: only a replan moves or supersedes items' using errcode = '22023';
  end if;

  -- Every row the payload names must belong to this trip. A new item is checked through the item
  -- it's copied from.
  if not exists (select 1 from public.agent_runs r where r.id = v_run and r.trip_id = v_trip) then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload -> 'slots') s
    where not exists (
      select 1 from public.itinerary_items i
      where i.id = coalesce((s ->> 'from_item_id')::uuid, (s ->> 'sibling_of')::uuid, (s ->> 'item_id')::uuid) and i.trip_id = v_trip
    )
  ) or exists (
    select 1 from unnest(v_supersede) sid
    where not exists (select 1 from public.itinerary_items i where i.id = sid and i.trip_id = v_trip)
  ) or exists (
    select 1 from jsonb_array_elements(v_shifts) t
    where not exists (select 1 from public.itinerary_items i where i.id = (t ->> 'item_id')::uuid and i.trip_id = v_trip)
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
    join public.itinerary_items i on i.id = coalesce((s ->> 'from_item_id')::uuid, (s ->> 'sibling_of')::uuid, (s ->> 'item_id')::uuid)
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

  -- Booked items never change.
  if exists (
    select 1 from public.itinerary_items i
    where i.status = 'booked'
      and (i.id = any (v_supersede) or i.id in (select (t ->> 'item_id')::uuid from jsonb_array_elements(v_shifts) t))
  ) then
    raise exception 'not_permitted: a booked item can''t be moved or replaced' using errcode = '42501';
  end if;
  -- Superseded items must be live, planned before, and free of a purchase in progress.
  perform 1 from public.itinerary_items i where i.id = any (v_supersede) for update;
  if exists (
    select 1 from public.itinerary_items i
    where i.id = any (v_supersede) and i.status not in ('proposing', 'voting', 'decided')
  ) then
    raise exception 'conflict: an item to replace isn''t open for re-planning; use the current trip context';
  end if;
  if exists (
    select 1 from public.mandates d
    where d.item_id = any (v_supersede) and d.status in ('open', 'partially_declined', 'authorized')
  ) then
    raise exception 'conflict: a purchase for this item is in progress, so it stays as it is';
  end if;

  -- Check every slot before writing any.
  for v_slot in select * from jsonb_array_elements(payload -> 'slots') loop
    v_item := (v_slot ->> 'item_id')::uuid;
    v_sibling_of := (v_slot ->> 'sibling_of')::uuid;
    v_from := (v_slot ->> 'from_item_id')::uuid;

    if v_from is not null then
      if not (v_from = any (v_supersede)) then
        raise exception 'invalid_input: item % is copied but not superseded', v_from using errcode = '22023';
      end if;
      if exists (select 1 from public.itinerary_items i where i.id = v_item) then
        raise exception 'invalid_input: the new item % already exists', v_item using errcode = '22023';
      end if;
      continue;
    end if;

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

  -- Shifted times first, so items copied below start at the new time.
  update public.itinerary_items i
  set starts_at = (t ->> 'starts_at')::timestamptz, ends_at = (t ->> 'ends_at')::timestamptz,
    shifted_min = i.shifted_min + coalesce((t ->> 'delta_min')::int, 0)
  from jsonb_array_elements(v_shifts) t
  where i.id = (t ->> 'item_id')::uuid and i.status <> 'booked';

  update public.itinerary_items set status = 'superseded'
  where id = any (v_supersede) and status in ('proposing', 'voting', 'decided');

  for v_slot in select * from jsonb_array_elements(payload -> 'slots') loop
    v_item := (v_slot ->> 'item_id')::uuid;
    v_sibling_of := (v_slot ->> 'sibling_of')::uuid;
    v_from := (v_slot ->> 'from_item_id')::uuid;

    if v_from is not null then
      -- The first group takes the old item's position; any other gets the next one.
      insert into public.itinerary_items (
        id, trip_id, slot_key, label, category, starts_at, ends_at, position, status, together,
        area_label, area_lat, area_lng, supersedes_item_id, created_by_run_id, seed_batch, shifted_min
      )
      select
        v_item, i.trip_id, i.slot_key, i.label, i.category, i.starts_at, i.ends_at,
        case when v_from = any (v_template_used)
          then (select coalesce(max(o.position), 0) + 1 from public.itinerary_items o where o.trip_id = i.trip_id and o.slot_key = i.slot_key)
          else i.position
        end,
        'tbd', i.together, i.area_label, i.area_lat, i.area_lng, i.id, v_run, i.seed_batch, i.shifted_min
      from public.itinerary_items i
      where i.id = v_from;
      v_template_used := v_template_used || v_from;
      v_created := v_created || v_item;
    elsif v_sibling_of is not null then
      -- The second group's lane: the same slot, key, and times, next in position, in tbd.
      insert into public.itinerary_items (
        id, trip_id, slot_key, label, category, starts_at, ends_at, position, together,
        area_label, area_lat, area_lng, created_by_run_id, seed_batch, shifted_min
      )
      select
        v_item, i.trip_id, i.slot_key, i.label, i.category, i.starts_at, i.ends_at,
        (select coalesce(max(o.position), 0) + 1 from public.itinerary_items o
         where o.trip_id = i.trip_id and o.slot_key = i.slot_key),
        false, i.area_label, i.area_lat, i.area_lng, v_run, i.seed_batch, i.shifted_min
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
    'changes', v_changes,
    'replayed', false,
    'created_item_ids', to_jsonb(v_created)
  );
end;
$$;

revoke execute on function public.apply_plan(jsonb) from public, anon, authenticated;
