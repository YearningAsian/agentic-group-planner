-- claim_invite: a signed-in user claims a placeholder's lane with its invite token (design §3.2
-- trip_members, §3.4, §5.3). It runs with the user's session, so auth.uid() is the claimer; it is
-- one of the four functions a client may call (web/tests/db/function-hardening.test.ts).
--
-- The token is cleared on claim, so a reused link would look unknown. claimed_token_hash keeps the
-- SHA-256 of the claimed token, so a second claim, or a preview of a used link, reads "already
-- used" instead (review focus 4). The hash can't claim anything.

alter table public.trip_members add column claimed_token_hash text;

comment on column public.trip_members.claimed_token_hash is
  'SHA-256 (hex) of the invite token this member was claimed with; tells a used link from an unknown one.';

create index trip_members_claimed_token_hash_idx on public.trip_members (claimed_token_hash)
  where claimed_token_hash is not null;

-- returns { trip_slug, member_id }. Raises, with the code before the colon:
--   unauthenticated  no session
--   not_found        no placeholder or invited member holds the token (including an empty token)
--   already_used     the token was claimed before
--   already_member   the caller is already a member of the token's trip
create function public.claim_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_member public.trip_members%rowtype;
  v_trip public.trips%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthenticated: sign in to join' using errcode = '42501';
  end if;
  if p_token is null or pg_catalog.btrim(p_token) = '' then
    raise exception 'not_found: no invite has this token' using errcode = 'P0002';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  -- Locking the open row serializes concurrent claims: the loser re-reads it after the winner
  -- commits, finds the token cleared, and falls through to "already used" below.
  select * into v_member
  from public.trip_members m
  where m.invite_token = p_token and m.status in ('placeholder', 'invited')
  for update;

  if not found then
    if exists (select 1 from public.trip_members m where m.claimed_token_hash = v_hash) then
      raise exception 'already_used: this invite was already claimed' using errcode = 'P0001';
    end if;
    raise exception 'not_found: no invite has this token' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.trip_members m
    where m.trip_id = v_member.trip_id and m.profile_id = v_uid
  ) then
    raise exception 'already_member: the caller is already a member of this trip' using errcode = 'P0001';
  end if;

  -- Forward only: placeholder | invited -> joined, and only while the row still holds the token.
  begin
    update public.trip_members
    set profile_id = v_uid,
        status = 'joined',
        claimed_at = now(),
        invite_token = null,
        claimed_token_hash = v_hash
    where id = v_member.id
      and status in ('placeholder', 'invited')
      and invite_token = p_token;
    -- The row lock makes this match; if it ever doesn't, another claim got there first.
    if not found then
      raise exception 'already_used: this invite was already claimed' using errcode = 'P0001';
    end if;
  exception when unique_violation then
    -- The caller claimed another lane on this trip in a concurrent request.
    raise exception 'already_member: the caller is already a member of this trip' using errcode = 'P0001';
  end;

  select * into v_trip from public.trips t where t.id = v_member.trip_id;

  -- Demo claimers take the trip's batch, so reset:demo removes them (design §10.5). A profile that
  -- already belongs to a batch keeps it, so a claim never moves a seeded user out of theirs.
  if v_trip.seed_batch is not null then
    update public.profiles
    set seed_batch = v_trip.seed_batch
    where id = v_uid and seed_batch is null;
  end if;

  return jsonb_build_object('trip_slug', v_trip.slug, 'member_id', v_member.id);
end;
$$;

revoke execute on function public.claim_invite(text) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;
