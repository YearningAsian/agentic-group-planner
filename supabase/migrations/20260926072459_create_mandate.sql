-- create_mandate: turns a propose_purchase call into a mandate, its share rows, and the approval
-- card, in one transaction, and marks the tool call succeeded (design §2.1, §3.4, §4.2). Called
-- only by the server (admin client) from createMandate() in the payments feature. The quote, the
-- split, the caps, and the fees are computed there (holdFees is the only fee math), so this
-- function stores those numbers after checking them against the rows they describe.
--
-- payload:
--   trip_id, actor_member_id (the run's requester, or the organizer for a server-started run),
--   run_id, tool_call_id,
--   mandate: { id, item_id, option_id, merchant, title, quote_id, quote_cents, cap_cents, currency,
--              expires_at, idempotency_key ('mandate:{run_id}:{tool_call_id}') },
--   shares: [{ share_member_id, payer_member_id, kind, share_cents, cap_cents, status }]: an own row
--           per attendee (pending, or awaiting_member with no payer for one who hasn't joined), and
--           a fronted row with the organizer as payer for each attendee who hasn't joined,
--   card: the approval card payload (validated with Zod before the call),
--   result_summary: the ToolResult summary the model sees.
-- returns { mandate_id, card_message_id, shares (the card's), replayed }.

create function public.create_mandate(payload jsonb)
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
  v_mandate jsonb := payload -> 'mandate';
  v_shares jsonb := payload -> 'shares';
  v_mandate_id uuid := (payload -> 'mandate' ->> 'id')::uuid;
  v_item uuid := (payload -> 'mandate' ->> 'item_id')::uuid;
  v_option uuid := (payload -> 'mandate' ->> 'option_id')::uuid;
  v_key text := payload -> 'mandate' ->> 'idempotency_key';
  v_call public.tool_calls%rowtype;
  v_existing uuid;
  v_item_status text;
  v_organizer uuid;
  v_constraint text;
  v_card uuid;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;

  -- Every row the payload names must belong to this trip.
  if not exists (select 1 from public.agent_runs r where r.id = v_run and r.trip_id = v_trip) then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.item_options o
    join public.itinerary_items i on i.id = o.item_id
    where o.id = v_option and o.item_id = v_item and i.trip_id = v_trip
  ) then
    raise exception 'not_permitted: the item or its option belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_shares) s
    cross join lateral (values (s ->> 'share_member_id'), (s ->> 'payer_member_id')) as named (member_id)
    where named.member_id is not null
      and not exists (
        select 1 from public.trip_members m where m.id = named.member_id::uuid and m.trip_id = v_trip
      )
  ) then
    raise exception 'not_permitted: a share names a member of another trip' using errcode = '42501';
  end if;

  if v_key is distinct from format('mandate:%s:%s', v_run, v_tool_call_id) then
    raise exception 'invalid_input: the idempotency key must be mandate:{run_id}:{tool_call_id}' using errcode = '22023';
  end if;

  -- Idempotency: the call that created this mandate returns it again and writes nothing.
  select * into v_call from public.tool_calls c
  where c.run_id = v_run and c.tool_call_id = v_tool_call_id
  for update;
  if not found then
    raise exception 'invalid_input: tool call % was not started', v_tool_call_id using errcode = '22023';
  end if;
  select m.id into v_existing from public.mandates m where m.idempotency_key = v_key;
  if v_existing is not null then
    return jsonb_build_object(
      'mandate_id', v_existing,
      'card_message_id', v_call.message_id,
      'shares', (select msg.card_payload -> 'shares' from public.messages msg where msg.id = v_call.message_id),
      'replayed', true
    );
  end if;
  if v_call.status <> 'started' then
    raise exception 'conflict: tool call % already %', v_tool_call_id, v_call.status;
  end if;

  -- Hold the item decided until this commits.
  select i.status into v_item_status from public.itinerary_items i where i.id = v_item for share;
  if v_item_status = 'booked' then
    raise exception 'conflict: this item is already booked';
  elsif v_item_status <> 'decided' then
    raise exception 'invalid_input: the item is %; the group confirms it in the comments before paying', v_item_status
      using errcode = '22023';
  end if;

  -- Lock the attendees' member rows, so a placeholder can't claim their lane until these share
  -- rows exist; the claim then finds their awaiting_member row.
  perform 1 from public.trip_members m
  where m.id in (select a.member_id from public.item_attendees a where a.item_id = v_item)
  for share;
  select m.id into v_organizer from public.trip_members m where m.trip_id = v_trip and m.role = 'organizer';

  -- Exactly one own row per attendee, and rows for attendees only.
  if (select count(*) from jsonb_array_elements(v_shares) s where s ->> 'kind' = 'own')
      <> (select count(*) from public.item_attendees a where a.item_id = v_item)
    or exists (
      select 1 from jsonb_array_elements(v_shares) s
      where not exists (
        select 1 from public.item_attendees a
        where a.item_id = v_item and a.member_id = (s ->> 'share_member_id')::uuid
      )
    )
  then
    raise exception 'invalid_input: the shares must be exactly the item''s attendees' using errcode = '22023';
  end if;

  -- Each row matches who has joined now: a joined member pays their own share; one who hasn't
  -- joined waits (awaiting_member), and the organizer fronts their share.
  if exists (
    select 1
    from jsonb_array_elements(v_shares) s
    join public.trip_members m on m.id = (s ->> 'share_member_id')::uuid
    where not (
      (s ->> 'kind' = 'own' and m.status = 'joined' and s ->> 'status' = 'pending'
        and (s ->> 'payer_member_id')::uuid = m.id)
      or (s ->> 'kind' = 'own' and m.status <> 'joined' and s ->> 'status' = 'awaiting_member'
        and s ->> 'payer_member_id' is null)
      or (s ->> 'kind' = 'fronted' and m.status <> 'joined' and s ->> 'status' = 'pending'
        and (s ->> 'payer_member_id')::uuid = v_organizer)
    )
  )
    or (select count(*) from jsonb_array_elements(v_shares) s where s ->> 'kind' = 'fronted')
      <> (select count(*) from jsonb_array_elements(v_shares) s where s ->> 'status' = 'awaiting_member')
  then
    raise exception 'conflict: the attendees changed while the purchase was being prepared; try again';
  end if;

  -- The own rows split the whole quote and their caps make the mandate's cap; a fronted row
  -- carries exactly the share it fronts.
  if (select sum((s ->> 'share_cents')::int) from jsonb_array_elements(v_shares) s where s ->> 'kind' = 'own')
      is distinct from (v_mandate ->> 'quote_cents')::int
    or (select sum((s ->> 'cap_cents')::int) from jsonb_array_elements(v_shares) s where s ->> 'kind' = 'own')
      is distinct from (v_mandate ->> 'cap_cents')::int
    or exists (
      select 1
      from jsonb_array_elements(v_shares) f
      join jsonb_array_elements(v_shares) o
        on o ->> 'share_member_id' = f ->> 'share_member_id' and o ->> 'kind' = 'own'
      where f ->> 'kind' = 'fronted'
        and ((f ->> 'share_cents')::int <> (o ->> 'share_cents')::int or (f ->> 'cap_cents')::int <> (o ->> 'cap_cents')::int)
    )
  then
    raise exception 'invalid_input: the share amounts don''t add up to the mandate' using errcode = '22023';
  end if;
  if payload -> 'card' ->> 'mandate_id' is distinct from v_mandate_id::text then
    raise exception 'invalid_input: the card names another mandate' using errcode = '22023';
  end if;

  begin
    insert into public.mandates (
      id, trip_id, item_id, option_id, merchant, title, quote_id, quote_cents, cap_cents, currency,
      expires_at, proposed_by_run_id, idempotency_key
    ) values (
      v_mandate_id,
      v_trip,
      v_item,
      v_option,
      v_mandate ->> 'merchant',
      v_mandate ->> 'title',
      v_mandate ->> 'quote_id',
      (v_mandate ->> 'quote_cents')::int,
      (v_mandate ->> 'cap_cents')::int,
      v_mandate ->> 'currency',
      (v_mandate ->> 'expires_at')::timestamptz,
      v_run,
      v_key
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'mandates_one_live_per_item_key' then
      raise exception 'conflict: the group is already approving a purchase for this item' using errcode = '23505';
    end if;
    raise;
  end;

  insert into public.payment_holds (
    trip_id, mandate_id, payer_member_id, share_member_id, kind, share_cents, cap_cents, status, idempotency_key
  )
  select
    v_trip,
    v_mandate_id,
    (s ->> 'payer_member_id')::uuid,
    (s ->> 'share_member_id')::uuid,
    s ->> 'kind',
    (s ->> 'share_cents')::int,
    (s ->> 'cap_cents')::int,
    s ->> 'status',
    format('share:%s:%s:%s', v_mandate_id, (s ->> 'share_member_id')::uuid, s ->> 'kind')
  from jsonb_array_elements(v_shares) s;

  insert into public.messages (trip_id, sender_type, kind, card_type, card_payload, agent_run_id)
  values (v_trip, 'agent', 'card', 'approval', payload -> 'card', v_run)
  returning id into v_card;

  update public.tool_calls
  set status = 'succeeded',
      output = jsonb_build_object('ok', true, 'summary', payload ->> 'result_summary', 'card_message_id', v_card),
      message_id = v_card
  where id = v_call.id and status = 'started';

  return jsonb_build_object(
    'mandate_id', v_mandate_id,
    'card_message_id', v_card,
    'shares', payload -> 'card' -> 'shares',
    'replayed', false
  );
end;
$$;

revoke execute on function public.create_mandate(jsonb) from public, anon, authenticated;
