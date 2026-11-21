-- Chat files a phone keeps, checked against what its owner can still see.
--
-- A phone keeps voice messages and video notes it has played (Documents/chat-media). Until now it let one go
-- only when its open conversation screen heard the message taken back or the chat cleared. A message taken
-- back, a chat cleared (here, on another phone, or by the other person for both) or a message hidden on another
-- phone while that screen was closed left its file on the phone, and in its backups, for good.
--
-- The phone now sends the paths it keeps, in batches, and drops every one this does not return. A path lives
-- while a message the caller can see names it: its file (`media_path`) or one of its parts or pictures
-- (`items`) — not taken back, after the caller's own clearing, not hidden by the caller. A forwarded copy the
-- caller still sees keeps the shared file alive. At most 500 paths are read per call.

create or replace function public.chat_media_alive(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.path), '{}'::text[])
    from unnest((p_paths)[1:500]) as p(path)
   where p.path is not null
     and (exists (select 1 from public.chat_messages m
                   where m.media_path = p.path
                     and m.deleted_at is null
                     and public.chat_message_visible(m.conversation_id, m.id, m.created_at))
          or exists (select 1 from public.chat_messages m
                      where m.items is not null
                        and m.items @> jsonb_build_array(jsonb_build_object('path', p.path))
                        and m.deleted_at is null
                        and public.chat_message_visible(m.conversation_id, m.id, m.created_at)));
$$;
revoke all on function public.chat_media_alive(text[]) from public, anon;
grant execute on function public.chat_media_alive(text[]) to authenticated;
