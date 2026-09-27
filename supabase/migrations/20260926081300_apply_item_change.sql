-- apply_item_change: update_item's write path (design §2.1, §3.4). One item change and its
-- itinerary_change card in one transaction, and the tool call marked succeeded. Called only by the
-- server (admin client) from the update_item tool.
--
-- payload:
--   trip_id, actor_member_id, run_id, tool_call_id,
--   action: 'swap_option' | 'mark_tbd' | 'set_attendees' | 'add_slot',
--   item_id (all but add_slot), option_id (swap_option), member_ids uuid[] (set_attendees),
--   new_item_id (mark_tbd and add_slot: the server picks it, so the card can name it),
--   slot (add_slot): { slot_key, label, category, starts_at, ends_at, together, area: { label, lat, lng } | null },
--   card: the itinerary_change card (validated with Zod before the call),
--   result_summary: the ToolResult summary the model sees,
--   result_handles (optional): the new handles, e.g. { "I5": "Lunch (TBD)" }, stored with the output.
-- returns { card_message_id, replayed: bool }
--
-- Rules: booked items never change; only the organizer locks an option (anyone else discusses it
-- in the comments); statuses only move forward, so mark_tbd supersedes the item with a new tbd
-- one; and an item with a purchase in progress keeps its option and attendees.

create function public.apply_item_change(payload jsonb)
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
  v_action text := payload ->> 'action';
  v_item_id uuid := (payload ->> 'item_id')::uuid;
  v_new_item uuid := (payload ->> 'new_item_id')::uuid;
  v_option uuid := (payload ->> 'option_id')::uuid;
  v_slot jsonb := payload -> 'slot';
  v_call public.tool_calls%rowtype;
  v_item public.itinerary_items%rowtype;
  v_role text;
  v_card uuid;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  select m.role into v_role from public.trip_members m
  where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined';
  if not found then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agent_runs r where r.id = v_run and r.trip_id = v_trip) then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;
  if v_action is null or v_action not in ('swap_option', 'mark_tbd', 'set_attendees', 'add_slot') then
    raise exception 'invalid_input: apply_item_change can''t apply %', coalesce(v_action, 'no action') using errcode = '22023';
  end if;

  -- Idempotency: a succeeded tool call returns its stored card and writes nothing.
  select * into v_call from public.tool_calls c
  where c.run_id = v_run and c.tool_call_id = v_tool_call_id
  for update;
  if not found then
    raise exception 'invalid_input: tool call % was not started', v_tool_call_id using errcode = '22023';
  end if;
  if v_call.status = 'succeeded' then
    return jsonb_build_object('card_message_id', v_call.message_id, 'replayed', true);
  end if;

  if v_action <> 'add_slot' then
    select * into v_item from public.itinerary_items i where i.id = v_item_id and i.trip_id = v_trip for update;
    if not found then
      raise exception 'not_permitted: the item belongs to another trip' using errcode = '42501';
    end if;
    if v_item.status = 'booked' then
      raise exception 'not_permitted: this item is booked, so it can''t change' using errcode = '42501';
    end if;
    if v_item.status in ('superseded', 'cancelled') then
      raise exception 'conflict: this item was replaced or cancelled; use the current one from the trip context';
    end if;
    if v_action in ('swap_option', 'mark_tbd', 'set_attendees') and exists (
      select 1 from public.mandates d
      where d.item_id = v_item.id and d.status in ('open', 'partially_declined', 'authorized')
    ) then
      raise exception 'conflict: a purchase for this item is in progress, so its option and attendees stay as they are';
    end if;
  end if;

  if v_action = 'swap_option' then
    if v_role <> 'organizer' then
      raise exception 'not_permitted: only the organizer locks an option; discuss it in the comments' using errcode = '42501';
    end if;
    if not exists (select 1 from public.item_options o where o.id = v_option and o.item_id = v_item.id) then
      raise exception 'invalid_input: that option isn''t one of this item''s options' using errcode = '22023';
    end if;
    if v_item.status = 'tbd' then
      raise exception 'conflict: this item has no options yet; plan it first';
    end if;
    -- Forward only: proposing -> voting -> decided, each a conditional update. A decided item
    -- keeps its status and takes the new option.
    update public.itinerary_items set status = 'voting' where id = v_item.id and status = 'proposing';
    update public.itinerary_items set status = 'decided', chosen_option_id = v_option
    where id = v_item.id and status in ('voting', 'decided');

  elsif v_action = 'mark_tbd' then
    if v_item.status = 'tbd' then
      raise exception 'conflict: this item is already TBD';
    end if;
    update public.itinerary_items set status = 'superseded'
    where id = v_item.id and status in ('proposing', 'voting', 'decided');
    insert into public.itinerary_items (
      id, trip_id, slot_key, label, category, starts_at, ends_at, position, status, together,
      area_label, area_lat, area_lng, supersedes_item_id, created_by_run_id, seed_batch
    ) values (
      v_new_item, v_trip, v_item.slot_key, v_item.label, v_item.category, v_item.starts_at, v_item.ends_at,
      v_item.position, 'tbd', v_item.together, v_item.area_label, v_item.area_lat, v_item.area_lng,
      v_item.id, v_run, v_item.seed_batch
    );
    insert into public.item_attendees (item_id, member_id, trip_id, seed_batch)
    select v_new_item, a.member_id, v_trip, a.seed_batch from public.item_attendees a where a.item_id = v_item.id;

  elsif v_action = 'set_attendees' then
    if jsonb_array_length(coalesce(payload -> 'member_ids', '[]'::jsonb)) = 0 then
      raise exception 'invalid_input: an item needs at least one attendee' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(payload -> 'member_ids') mid
      where not exists (select 1 from public.trip_members m where m.id = mid::uuid and m.trip_id = v_trip)
    ) then
      raise exception 'not_permitted: a member belongs to another trip' using errcode = '42501';
    end if;
    delete from public.item_attendees a
    where a.item_id = v_item.id
      and a.member_id not in (select mid::uuid from jsonb_array_elements_text(payload -> 'member_ids') mid);
    insert into public.item_attendees (item_id, member_id, trip_id, seed_batch)
    select distinct v_item.id, mid::uuid, v_trip, v_item.seed_batch
    from jsonb_array_elements_text(payload -> 'member_ids') mid
    on conflict do nothing;

  else -- add_slot
    if v_slot is null then
      raise exception 'invalid_input: add_slot needs a slot' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.itinerary_items i
      where i.trip_id = v_trip and i.slot_key = v_slot ->> 'slot_key' and i.status not in ('superseded', 'cancelled')
    ) then
      raise exception 'conflict: the trip already has a % slot; pick another slot_key', v_slot ->> 'slot_key';
    end if;
    insert into public.itinerary_items (
      id, trip_id, slot_key, label, category, starts_at, ends_at, position, status, together,
      area_label, area_lat, area_lng, created_by_run_id, seed_batch
    )
    select
      v_new_item, v_trip, v_slot ->> 'slot_key', v_slot ->> 'label', v_slot ->> 'category',
      (v_slot ->> 'starts_at')::timestamptz, (v_slot ->> 'ends_at')::timestamptz, 1, 'tbd',
      coalesce((v_slot ->> 'together')::boolean, false),
      v_slot -> 'area' ->> 'label', (v_slot -> 'area' ->> 'lat')::double precision,
      (v_slot -> 'area' ->> 'lng')::double precision, v_run, t.seed_batch
    from public.trips t where t.id = v_trip;
    -- Everyone is on a new slot until someone says otherwise.
    insert into public.item_attendees (item_id, member_id, trip_id, seed_batch)
    select v_new_item, m.id, v_trip, m.seed_batch from public.trip_members m where m.trip_id = v_trip;
  end if;

  insert into public.messages (trip_id, sender_type, kind, card_type, card_payload, agent_run_id)
  values (v_trip, 'agent', 'card', 'itinerary_change', payload -> 'card', v_run)
  returning id into v_card;

  update public.tool_calls
  set status = 'succeeded',
      output = jsonb_build_object('ok', true, 'summary', payload ->> 'result_summary', 'card_message_id', v_card)
        || case when payload ? 'result_handles' and jsonb_typeof(payload -> 'result_handles') = 'object'
                then jsonb_build_object('handles', payload -> 'result_handles') else '{}'::jsonb end,
      message_id = v_card
  where id = v_call.id and status = 'started';

  return jsonb_build_object('card_message_id', v_card, 'replayed', false);
end;
$$;

revoke execute on function public.apply_item_change(jsonb) from public, anon, authenticated;
