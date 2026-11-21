-- Chat search: one box for everything (2.1).
--
-- The chat tab now has a single search box, and it is global. Conversations
-- are matched on the phone, which already holds them; these two answer the
-- rest.
--
-- * chat_search_people: anyone in the app, by name or by handle. It keeps the
--   rules the new-chat search (search_profiles_by_username) has always kept:
--   signed in, two characters at least, never the caller, only active accounts
--   that chose a handle (choosing one is what makes an account findable), and
--   display fields only. That search matches handles alone and is also the
--   coin-transfer search, so it is left as it is and this one stands beside
--   it. One rule more: never someone who blocked the caller. A block already
--   hides whether that person is online; turning up in the caller's search
--   would undo it, and a chat opened with them could only end in "cannot be
--   delivered". Someone the caller blocked is still found: that is the way
--   back to unblocking them. A query that starts with "@" means a handle and
--   matches handles only.
-- * chat_search_messages: words in the caller's own conversations, and only
--   the messages the caller can see there (a member, after their own
--   clearing, not hidden by them, not taken back), newest first, each with a
--   stretch of text around the match.
--
-- Both fold case, apostrophes and the two Uzbek Latin alphabets together the
-- way typed game answers are graded (game_normalize_text), so "Şoxrux" finds
-- "Shoxrux" and "o'g'il" finds "o‘g‘il". %, _ and \ typed into the box match
-- themselves, not anything.

create or replace function public.chat_search_people(p_query text, p_limit integer default 15)
returns table (id uuid, full_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  with asked as (
    select public.game_normalize_text(regexp_replace(btrim(coalesce(p_query, '')), '^@+', '')) as term,
           btrim(coalesce(p_query, '')) like '@%' as handle_only
  ), q as (
    select term, handle_only,
           replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') as literal
      from asked
  )
  select p.id, p.full_name, p.username, p.avatar_url
    from public.profiles p, q
   where auth.uid() is not null
     and char_length(q.term) >= 2
     and p.id <> auth.uid()
     and p.status = 'active'
     and p.username is not null
     and (lower(p.username) like '%' || q.literal || '%'
          or (not q.handle_only and public.game_normalize_text(p.full_name) like '%' || q.literal || '%'))
     and not exists (select 1 from public.chat_blocks b where b.owner_id = p.id and b.blocked_id = auth.uid())
   -- The handle typed in full first, then handles and names that begin with
   -- what was typed (a surname too), then the shortest handle.
   order by (lower(p.username) = q.term) desc,
            (lower(p.username) like q.literal || '%') desc,
            (public.game_normalize_text(p.full_name) like q.literal || '%'
             or public.game_normalize_text(p.full_name) like '% ' || q.literal || '%') desc,
            char_length(p.username), p.username
   limit greatest(1, least(coalesce(p_limit, 15), 25));
$$;

comment on function public.chat_search_people(text, integer) is
  'Chat search: people by name or handle (a leading @ means handle only). Active accounts with a handle, never the caller, never anyone who blocked the caller; display fields only.';

revoke all on function public.chat_search_people(text, integer) from public, anon;
grant execute on function public.chat_search_people(text, integer) to authenticated;
grant execute on function public.chat_search_people(text, integer) to service_role;

create or replace function public.chat_search_messages(p_query text, p_limit integer default 30)
returns table (id uuid, conversation_id uuid, peer_id uuid, sender_id uuid, kind text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with asked as (
    select public.game_normalize_text(coalesce(p_query, '')) as term,
           lower(btrim(coalesce(p_query, ''))) as plain
  ), q as (
    select term, plain,
           replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') as literal
      from asked
  )
  select m.id, m.conversation_id, peer.user_id, m.sender_id, m.kind,
         -- Where the words are deep in a long message, the stretch starts a
         -- little before them. (A match found only by folding the alphabets
         -- is not located; the message's start is shown instead.)
         case when strpos(lower(m.body), q.plain) > 60
              then '…' || substr(m.body, strpos(lower(m.body), q.plain) - 40, 200)
              else left(m.body, 200) end,
         m.created_at
    from q,
         public.chat_members me
         join public.chat_messages m on m.conversation_id = me.conversation_id
         left join public.chat_members peer on peer.conversation_id = me.conversation_id and peer.user_id <> me.user_id
   where me.user_id = auth.uid()
     and char_length(q.term) >= 2
     and m.deleted_at is null
     and m.body <> ''
     and (me.cleared_at is null or m.created_at > me.cleared_at)
     and not exists (select 1 from public.chat_hidden h where h.user_id = me.user_id and h.message_id = m.id)
     and public.game_normalize_text(m.body) like '%' || q.literal || '%'
   order by m.created_at desc, m.id
   limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

comment on function public.chat_search_messages(text, integer) is
  'Chat search: messages containing the words, in the caller''s own conversations, as the caller sees them (after their clearing, not hidden, not taken back); newest first.';

revoke all on function public.chat_search_messages(text, integer) from public, anon;
grant execute on function public.chat_search_messages(text, integer) to authenticated;
grant execute on function public.chat_search_messages(text, integer) to service_role;
