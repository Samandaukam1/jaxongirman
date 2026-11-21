-- Chat 2.1, closed further: between two people one of whom blocked the other,
-- neither can pin or unpin in their conversation (the other's pinned bar would
-- change) nor clear it for both (the other's history would vanish, with the
-- messages they may want to report). Sending, editing, reacting and forwarding
-- already refuse this (202611170001).

create or replace function public.chat_pin(p_message_id uuid, p_pinned boolean default true)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.chat_messages%rowtype;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_row from public.chat_messages where id = p_message_id for update;
  if not found or v_row.deleted_at is not null
     or not public.chat_message_visible(v_row.conversation_id, v_row.id, v_row.created_at) then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;
  -- Between two people one of whom blocked the other, nothing changes on the other's screen.
  if exists (select 1 from public.chat_members peer
              where peer.conversation_id = v_row.conversation_id and peer.user_id <> v_me
                and public.chat_blocked_between(v_me, peer.user_id)) then
    raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
  end if;
  update public.chat_messages
     set pinned_at = case when coalesce(p_pinned, true) then now() end,
         pinned_by = case when coalesce(p_pinned, true) then v_me end
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.chat_clear(p_conversation_id uuid, p_for_everyone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_members where conversation_id = p_conversation_id and user_id = v_me) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if coalesce(p_for_everyone, false) then
    -- Clearing for both reaches into the other's history: not between two people one of whom blocked the other.
    if exists (select 1 from public.chat_members peer
                where peer.conversation_id = p_conversation_id and peer.user_id <> v_me
                  and public.chat_blocked_between(v_me, peer.user_id)) then
      raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
    end if;
    if exists (select 1 from public.chat_members
                where conversation_id = p_conversation_id and user_id <> v_me and protect_history) then
      raise exception 'Suhbatdosh yozishmani ikki tomonlama tozalashni cheklagan.' using errcode = '42501', detail = 'protected';
    end if;
    update public.chat_members set cleared_at = now() where conversation_id = p_conversation_id;
    update public.chat_messages set pinned_at = null, pinned_by = null
     where conversation_id = p_conversation_id and pinned_at is not null;
  else
    update public.chat_members set cleared_at = now() where conversation_id = p_conversation_id and user_id = v_me;
  end if;
end;
$$;
