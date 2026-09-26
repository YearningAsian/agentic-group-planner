-- The agent's model provider moves from xAI to Meta's Model API; Gemini stays the fallback.
-- Postgres named the inline check agent_runs_provider_check. Any xai rows (local test data
-- only; no hosted project has these tables yet) become meta so the new check holds.
alter table public.agent_runs drop constraint agent_runs_provider_check;
update public.agent_runs set provider = 'meta' where provider = 'xai';
alter table public.agent_runs
  add constraint agent_runs_provider_check check (provider in ('meta', 'google', 'mock'));
