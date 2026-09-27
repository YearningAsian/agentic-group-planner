-- Profile updates (design §3.2 profiles, §5.1; PATCH /api/profile). A user updates only their own
-- row, and only its display name and avatar; the server keeps the Stripe fields and the seed batch.
-- Renaming copies the name onto the user's joined trip_members rows in the same statement, since
-- other members read names from trip_members.

-- Column privileges: without these, a user's session could write any column the policy lets through.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- The same limits as the route's schema, for a client that writes through the API directly.
create policy "profiles: users update their own name and avatar" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 80
    and (
      avatar_url is null
      or (avatar_url ~* '^https?://' and pg_catalog.char_length(avatar_url) <= 2048)
    )
  );

-- Runs as the owner, because users have no direct writes on trip_members. It touches only the rows
-- whose profile_id is the profile being updated, and that update already passed the policy above.
create function public.copy_display_name_to_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trip_members m
  set display_name = new.display_name
  where m.profile_id = new.id
    and m.status = 'joined'
    and m.display_name is distinct from new.display_name;
  return null;
end;
$$;

revoke execute on function public.copy_display_name_to_members() from public, anon, authenticated;

create trigger profiles_copy_display_name_to_members
  after update of display_name on public.profiles
  for each row
  when (old.display_name is distinct from new.display_name)
  execute function public.copy_display_name_to_members();
