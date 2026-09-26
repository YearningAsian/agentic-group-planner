-- cover_shortfall (design §4.2, plan CO-S02): the organizer takes on each share that no row can pay
-- any more, because its member declined (or their card did) and nothing else covers it. Each such
-- share gets a `fronted` row, payer the organizer, on a cover hold of its own: an authorized
-- PaymentIntent can't grow, so the organizer's main hold stays as approved. The row's
-- idempotency_key, `cover:{mandate_id}:{share_member_id}`, is how the app tells a cover hold's rows
-- from the main hold's. Called only by the server (admin client) from coverShortfall(), which then
-- authorizes each pending cover row.
--
-- payload: trip_id, actor_member_id (the trip's joined organizer), mandate_id.
-- returns { rows: [{ id, share_member_id, cap_cents, status }] }: every cover row of the mandate,
-- including ones an earlier call created, so a retry picks up where it stopped. The organizer's own
-- share isn't covered (their card is the one covering), and neither is a share that already has a
-- fronted row: a placeholder's, or an earlier cover. A mandate still `open` whose decline only the
-- payment_failed webhook recorded moves to `partially_declined` here.

create function public.cover_shortfall(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := (payload ->> 'trip_id')::uuid;
  v_actor uuid := (payload ->> 'actor_member_id')::uuid;
  v_mandate_id uuid := (payload ->> 'mandate_id')::uuid;
  v_mandate public.mandates%rowtype;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trip_members m where m.id = v_actor and m.role = 'organizer') then
    raise exception 'not_permitted: only the organizer can cover a shortfall' using errcode = '42501';
  end if;

  -- Locks the mandate, so concurrent covers insert each row once and see each other's rows.
  select * into v_mandate from public.mandates m where m.id = v_mandate_id and m.trip_id = v_trip for update;
  if not found then
    raise exception 'not_permitted: the purchase belongs to another trip' using errcode = '42501';
  end if;
  if v_mandate.status = 'open' and exists (
    select 1 from public.payment_holds o
    where o.mandate_id = v_mandate_id
      and o.kind = 'own'
      and o.share_member_id <> v_actor
      -- Nobody can pay it any more: no row for the share is live, and it has no fronted row yet.
      and not exists (
        select 1 from public.payment_holds r
        where r.mandate_id = v_mandate_id
          and r.share_member_id = o.share_member_id
          and (r.status in ('awaiting_member', 'pending', 'authorized', 'captured') or r.kind = 'fronted')
      )
  ) then
    update public.mandates set status = 'partially_declined' where id = v_mandate_id and status = 'open';
    v_mandate.status := 'partially_declined';
  end if;
  if v_mandate.status <> 'partially_declined' then
    raise exception 'conflict: nobody has declined, so there''s no shortfall to cover';
  end if;

  insert into public.payment_holds (
    trip_id, mandate_id, payer_member_id, share_member_id, kind, share_cents, cap_cents, status, idempotency_key, seed_batch
  )
  select
    v_trip, v_mandate_id, v_actor, o.share_member_id, 'fronted', o.share_cents, o.cap_cents, 'pending',
    format('cover:%s:%s', v_mandate_id, o.share_member_id), o.seed_batch
  from public.payment_holds o
  where o.mandate_id = v_mandate_id
      and o.kind = 'own'
      and o.share_member_id <> v_actor
      -- Nobody can pay it any more: no row for the share is live, and it has no fronted row yet.
      and not exists (
        select 1 from public.payment_holds r
        where r.mandate_id = v_mandate_id
          and r.share_member_id = o.share_member_id
          and (r.status in ('awaiting_member', 'pending', 'authorized', 'captured') or r.kind = 'fronted')
      )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'share_member_id', h.share_member_id, 'cap_cents', h.cap_cents, 'status', h.status))
    from public.payment_holds h
    where h.mandate_id = v_mandate_id and h.idempotency_key = format('cover:%s:%s', v_mandate_id, h.share_member_id)
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.cover_shortfall(jsonb) from public, anon, authenticated;
