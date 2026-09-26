-- Finalizing a mandate (design §4.2): a claim so one finalizer does the work, and complete_mandate,
-- the write that records a finished purchase in one transaction.

-- The finalizer's claim, taken with one conditional update before it books and captures, so of
-- several concurrent finalizers exactly one calls the merchant and the payments provider. It
-- lapses on its own, so a crash only delays a retry. Like payment_holds.lease_expires_at.
alter table public.mandates add column lease_expires_at timestamptz;

-- complete_mandate: after book() confirmed and each PaymentIntent was captured, records the
-- booking, the paying share rows as captured and the others as released, the mandate as captured
-- with its final amount, the item as booked and pinned, and the booking_confirmed card. Called
-- only by the server (admin client) from finalizeMandate() in the payments feature.
--
-- payload:
--   trip_id, actor_member_id (the organizer: finalizing runs on the group's behalf), mandate_id,
--   booking: { id, provider, provider_ref, confirmation_code, total_cents, currency, details },
--   captures: [{ row_id, captured_cents }]: the row that pays each share (pays_share = true),
--   releases: [row_id]: authorized rows that don't pay (pays_share = false),
--   card: the booking_confirmed payload (validated with Zod before the call).
-- returns { booking_id, card_message_id, replayed }. Calling it again for a captured mandate
-- returns the first call's booking and card and writes nothing.

create function public.complete_mandate(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := (payload ->> 'trip_id')::uuid;
  v_actor uuid := (payload ->> 'actor_member_id')::uuid;
  v_mandate_id uuid := (payload ->> 'mandate_id')::uuid;
  v_booking jsonb := payload -> 'booking';
  v_captures jsonb := coalesce(payload -> 'captures', '[]'::jsonb);
  v_releases jsonb := coalesce(payload -> 'releases', '[]'::jsonb);
  v_mandate public.mandates%rowtype;
  v_booking_id uuid;
  v_card uuid;
  v_final int;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;

  -- Every row the payload names must belong to this trip: the mandate, and its own share rows.
  select * into v_mandate from public.mandates m where m.id = v_mandate_id and m.trip_id = v_trip for update;
  if not found then
    raise exception 'not_permitted: the purchase belongs to another trip' using errcode = '42501';
  end if;
  if exists (
    select 1
    from (
      select (c ->> 'row_id') as row_id from jsonb_array_elements(v_captures) c
      union all
      select r #>> '{}' from jsonb_array_elements(v_releases) r
    ) named
    where not exists (
      select 1 from public.payment_holds h where h.id::text = named.row_id and h.mandate_id = v_mandate_id
    )
  ) then
    raise exception 'not_permitted: a share row belongs to another purchase' using errcode = '42501';
  end if;

  -- Idempotency: a finished purchase returns its booking and card.
  if v_mandate.status = 'captured' then
    select b.id into v_booking_id from public.bookings b where b.mandate_id = v_mandate_id;
    select msg.id into v_card from public.messages msg
    where msg.trip_id = v_trip and msg.card_type = 'booking_confirmed' and msg.card_payload ->> 'booking_id' = v_booking_id::text;
    return jsonb_build_object('booking_id', v_booking_id, 'card_message_id', v_card, 'replayed', true);
  end if;
  if v_mandate.status <> 'authorized' then
    raise exception 'conflict: the purchase is %, not authorized', v_mandate.status;
  end if;

  -- The rows must match the plan finalizeMandate stored before it captured (pays_share).
  if exists (
    select 1 from jsonb_array_elements(v_captures) c
    join public.payment_holds h on h.id = (c ->> 'row_id')::uuid
    where h.pays_share is distinct from true or h.status not in ('authorized', 'captured')
  ) or exists (
    select 1 from jsonb_array_elements(v_releases) r
    join public.payment_holds h on h.id = (r #>> '{}')::uuid
    where h.pays_share is distinct from false or h.status not in ('authorized', 'released')
  ) then
    raise exception 'conflict: the share rows no longer match the capture plan';
  end if;
  if payload -> 'card' ->> 'booking_id' is distinct from v_booking ->> 'id'
    or payload -> 'card' ->> 'item_id' is distinct from v_mandate.item_id::text
  then
    raise exception 'invalid_input: the card names another booking or item' using errcode = '22023';
  end if;

  -- Forward only: a webhook may already have captured or released a row.
  update public.payment_holds h
  set status = 'captured',
      captured_cents = (c ->> 'captured_cents')::int,
      captured_at = coalesce(h.captured_at, now()),
      lease_expires_at = null
  from jsonb_array_elements(v_captures) c
  where h.id = (c ->> 'row_id')::uuid and h.status in ('authorized', 'captured');

  update public.payment_holds h
  set status = 'released', lease_expires_at = null
  where h.id in (select (r #>> '{}')::uuid from jsonb_array_elements(v_releases) r) and h.status = 'authorized';

  select coalesce(sum((c ->> 'captured_cents')::int), 0) into v_final from jsonb_array_elements(v_captures) c;

  insert into public.bookings (
    id, trip_id, item_id, option_id, mandate_id, provider, provider_ref, confirmation_code, status,
    total_cents, currency, payer, details, confirmed_at, idempotency_key
  ) values (
    (v_booking ->> 'id')::uuid,
    v_trip,
    v_mandate.item_id,
    v_mandate.option_id,
    v_mandate_id,
    v_booking ->> 'provider',
    v_booking ->> 'provider_ref',
    v_booking ->> 'confirmation_code',
    'confirmed',
    (v_booking ->> 'total_cents')::int,
    v_booking ->> 'currency',
    'split',
    coalesce(v_booking -> 'details', '{}'::jsonb),
    now(),
    format('booking:%s', v_mandate_id)
  )
  returning id into v_booking_id;

  update public.mandates
  set status = 'captured', final_cents = v_final, lease_expires_at = null
  where id = v_mandate_id and status = 'authorized';

  -- The money has moved, so a changed item doesn't undo the purchase; it just isn't re-marked.
  update public.itinerary_items
  set status = 'booked', pinned = true
  where id = v_mandate.item_id and status = 'decided';

  insert into public.messages (trip_id, sender_type, kind, card_type, card_payload)
  values (v_trip, 'system', 'card', 'booking_confirmed', payload -> 'card')
  returning id into v_card;

  return jsonb_build_object('booking_id', v_booking_id, 'card_message_id', v_card, 'replayed', false);
end;
$$;

revoke execute on function public.complete_mandate(jsonb) from public, anon, authenticated;
