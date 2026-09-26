-- A member's message may link to an item (a comment, design §5.3) or reply to a message, but only
-- on the same trip. The foreign keys alone would accept another trip's item or message, so a
-- comment could attach itself to a trip its author isn't in.

drop policy "messages: members post their own text" on public.messages;

create policy "messages: members post their own text" on public.messages
  for insert to authenticated with check (
    sender_type = 'member'
    and kind = 'text'
    and card_type is null
    and card_payload is null
    and agent_run_id is null
    and exists (
      select 1 from public.trip_members m
      where m.id = sender_member_id and m.trip_id = messages.trip_id
        and m.profile_id = (select auth.uid()) and m.status = 'joined'
    )
    and (
      item_id is null
      or exists (select 1 from public.itinerary_items i where i.id = item_id and i.trip_id = messages.trip_id)
    )
    and (
      reply_to_message_id is null
      or exists (select 1 from public.messages r where r.id = reply_to_message_id and r.trip_id = messages.trip_id)
    )
  );
