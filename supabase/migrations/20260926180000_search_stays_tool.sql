-- search_stays joins the agent's tool_name enum (plan CO-S05).

alter table public.tool_calls drop constraint tool_calls_tool_name_check;
alter table public.tool_calls
  add constraint tool_calls_tool_name_check check (tool_name in (
    'search_places', 'plan_day', 'update_item', 'summarize', 'propose_purchase', 'remember_preference', 'search_stays'
  ));
