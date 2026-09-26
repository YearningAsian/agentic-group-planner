-- Lists every security definer function in public, whether it pins search_path, and whether a
-- signed-in client can execute it. One test covers every function, including ones added later.

create function public.audit_definer_functions()
returns table (name text, search_path_pinned boolean, client_can_execute boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.proname::text,
         coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false),
         has_function_privilege('authenticated', p.oid, 'execute')
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
$$;

revoke execute on function public.audit_definer_functions() from public, anon, authenticated;
