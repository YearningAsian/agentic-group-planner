-- finish_agent_run: ends an agent run and writes what members see, in one transaction. A run that
-- succeeds gets exactly one agent text message; a run that fails gets exactly one error card
-- (design §4.4, §7.3). Called only by the server (admin client) from the runner in lib/agent.
--
-- payload:
--   trip_id, actor_member_id (the run's requester, or the organizer for a server-started run),
--   run_id, status ('succeeded' | 'failed'),
--   message: { kind: 'text', body } when succeeded, or
--            { kind: 'card', card_type: 'error', card_payload } when failed
--            (the payload is validated with Zod before the call),
--   step_count, usage, replayed, error (all optional).
-- returns { finished: bool, status, message_id }. finished is false when the run had already ended;
-- then nothing is written, so a retried or racing finish is a no-op.

create function public.finish_agent_run(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := (payload ->> 'trip_id')::uuid;
  v_actor uuid := (payload ->> 'actor_member_id')::uuid;
  v_run_id uuid := (payload ->> 'run_id')::uuid;
  v_status text := payload ->> 'status';
  v_message jsonb := payload -> 'message';
  v_run public.agent_runs%rowtype;
  v_message_id uuid;
begin
  -- RLS doesn't apply under the admin client, so check the actor here.
  if not exists (
    select 1 from public.trip_members m
    where m.id = v_actor and m.trip_id = v_trip and m.status = 'joined'
  ) then
    raise exception 'not_permitted: the actor is not a joined member of this trip' using errcode = '42501';
  end if;

  select * into v_run from public.agent_runs r where r.id = v_run_id and r.trip_id = v_trip for update;
  if not found then
    raise exception 'not_permitted: the run belongs to another trip' using errcode = '42501';
  end if;

  -- Idempotency: an ended run keeps its outcome, and a second finish writes nothing.
  if v_run.status in ('succeeded', 'failed') then
    return jsonb_build_object('finished', false, 'status', v_run.status, 'message_id', null);
  end if;

  if v_status = 'succeeded' then
    if v_run.status <> 'running' then
      raise exception 'conflict: run % is %, so it can''t succeed', v_run_id, v_run.status;
    end if;
    if v_message ->> 'kind' is distinct from 'text' or coalesce(v_message ->> 'body', '') = '' then
      raise exception 'invalid_input: a succeeded run ends with an agent text message' using errcode = '22023';
    end if;
  elsif v_status = 'failed' then
    if v_message ->> 'kind' is distinct from 'card' or v_message ->> 'card_type' is distinct from 'error' then
      raise exception 'invalid_input: a failed run ends with an error card' using errcode = '22023';
    end if;
  else
    raise exception 'invalid_input: status must be succeeded or failed' using errcode = '22023';
  end if;

  insert into public.messages (
    trip_id, sender_type, kind, body, card_type, card_payload, agent_run_id, reply_to_message_id
  ) values (
    v_trip,
    'agent',
    v_message ->> 'kind',
    v_message ->> 'body',
    v_message ->> 'card_type',
    v_message -> 'card_payload',
    v_run_id,
    v_run.trigger_message_id
  )
  returning id into v_message_id;

  -- Forward only: running -> succeeded | failed, or queued -> failed for a run that never started.
  update public.agent_runs
  set status = v_status,
      finished_at = now(),
      lease_expires_at = null,
      step_count = coalesce((payload ->> 'step_count')::int, step_count),
      usage = coalesce(payload -> 'usage', usage),
      replayed = coalesce((payload ->> 'replayed')::boolean, replayed),
      error = payload -> 'error'
  where id = v_run_id and status = v_run.status;

  return jsonb_build_object('finished', true, 'status', v_status, 'message_id', v_message_id);
end;
$$;

revoke execute on function public.finish_agent_run(jsonb) from public, anon, authenticated;
