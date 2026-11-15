-- Push notifications (Jaxongirman.app 2.0, §1 "Bildirishnomalar").
--
-- The in-app list already exists (`notifications`). This makes everything that
-- lands in it, and every chat message, also reach the phone while the app is
-- closed.
--
-- The shape is an outbox. Something worth telling a person about inserts a
-- row into `push_outbox`, in the same transaction as the thing itself, so a
-- push is sent if and only if the message or the notification really
-- happened. Sending is not done here: a database must not wait on the
-- network. A statement-level trigger nudges the `push-dispatch` edge function
-- through pg_net (asynchronous — the request goes out after commit), and a
-- cron job nudges it every minute as well, so a nudge lost to a restart only
-- delays a push, never drops it. The function claims rows, sends them through
-- Expo's push service — which speaks APNs and FCM for us — and marks them.
--
-- Where the function lives and the secret it checks are not in this file:
-- they are two Vault secrets, `push_dispatch_url` and `push_dispatch_secret`,
-- set per environment. Until they are set, rows wait in the outbox and
-- nothing is sent — which is the correct behaviour for a project that has no
-- push credentials yet.
--
-- A phone registers its Expo push token when its owner signs in and drops it
-- when they sign out. A token belongs to one account at a time: the same
-- phone signed into another account moves the token, so the previous account's
-- messages stop arriving on a phone that is no longer theirs.

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  device_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform check (platform in ('ios', 'android')),
  constraint push_tokens_shape check (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$')
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from public, anon, authenticated;
grant select (token, platform, device_name, created_at) on public.push_tokens to authenticated;
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null default '',
  /** What the phone opens when the push is tapped, and what it needs to decide whether to show it. */
  data jsonb not null default '{}'::jsonb,
  channel text not null default 'default',
  status text not null default 'pending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint push_outbox_channel check (channel in ('default', 'chat')),
  constraint push_outbox_status check (status in ('pending', 'sending', 'sent', 'failed'))
);
create index if not exists push_outbox_pending_idx on public.push_outbox (id) where status in ('pending', 'sending');
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;

/* ----------------------------------------------------------- registering */

/** This phone's token, for the account signed in on it now. */
create or replace function public.push_token_register(p_token text, p_platform text, p_device text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$' then
    raise exception 'Push token noto‘g‘ri.' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then raise exception 'Platforma noto‘g‘ri.' using errcode = '22023'; end if;
  insert into public.push_tokens (token, user_id, platform, device_name)
  values (p_token, auth.uid(), p_platform, left(btrim(coalesce(p_device, '')), 80))
  on conflict (token) do update set
    user_id = excluded.user_id, platform = excluded.platform, device_name = excluded.device_name, updated_at = now();
  -- One account keeps at most ten phones: the oldest go first.
  delete from public.push_tokens
   where user_id = auth.uid()
     and token not in (select token from public.push_tokens where user_id = auth.uid() order by updated_at desc limit 10);
end;
$$;

/** Signing out of this phone: its pushes stop. */
create or replace function public.push_token_unregister(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.push_token_register(text, text, text) from public, anon;
revoke all on function public.push_token_unregister(text) from public, anon;
grant execute on function public.push_token_register(text, text, text) to authenticated;
grant execute on function public.push_token_unregister(text) to authenticated;

/* ------------------------------------------------------------ enqueuing */

/** Whether a person has any phone to push to. Nobody is queued for a push no phone will receive. */
create or replace function public.push_reachable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.push_tokens where user_id = p_user); $$;
revoke all on function public.push_reachable(uuid) from public, anon, authenticated;

/** Everything in the in-app list is pushed too, opening where the list item opens. */
create or replace function public.push_from_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.push_reachable(new.user_id) then
    insert into public.push_outbox (user_id, title, body, data)
    values (new.user_id, left(new.title, 160), left(coalesce(new.body, ''), 300),
            jsonb_build_object('url', coalesce(new.deep_link, '/notifications'), 'kind', new.kind, 'notification_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.push_from_notification();

/**
 * What a chat message says on a lock screen, in the recipient's language: its
 * text, or what kind of thing it is. Uzbek in the updated alphabet, as the app
 * writes it.
 */
create or replace function public.push_chat_preview(p_kind text, p_body text, p_share jsonb, p_language text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'text' then left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 180)
    when 'image' then case p_language when 'ru' then 'Фото' when 'en' then 'Photo' when 'tr' then 'Fotoğraf' else 'Rasm' end
    when 'voice' then case p_language when 'ru' then 'Голосовое сообщение' when 'en' then 'Voice message' when 'tr' then 'Sesli mesaj' else 'Ovozli xabar' end
    when 'video' then case p_language when 'ru' then 'Видеосообщение' when 'en' then 'Video message' when 'tr' then 'Görüntülü mesaj' else 'Video xabar' end
    when 'share' then case p_language when 'ru' then 'Отправлено: ' when 'en' then 'Shared: ' when 'tr' then 'Paylaşıldı: ' else 'Ulaşildi: ' end
                      || coalesce(p_share ->> 'title', '')
    else ''
  end;
$$;

/**
 * A chat message reaches every other member's phone — unless they muted the
 * sender. The title is the sender as the recipient knows them: the name they
 * saved them under, or their profile name. Pushes for one conversation are
 * tagged with it, so the phone groups them and the open chat can stay quiet.
 */
create or replace function public.push_from_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_outbox (user_id, title, body, data, channel)
  select m.user_id,
         left(coalesce(nullif(btrim(c.display_name), ''), nullif(btrim(p.full_name), ''), '@' || p.username, 'Jaxongirman'), 160),
         public.push_chat_preview(new.kind, new.body, new.share, coalesce(r.preferred_language, 'uz')),
         jsonb_build_object('url', '/chat/' || new.conversation_id, 'conversation_id', new.conversation_id, 'message_id', new.id, 'kind', 'chat'),
         'chat'
    from public.chat_members m
    join public.profiles p on p.id = new.sender_id
    left join public.profiles r on r.id = m.user_id
    left join public.chat_contacts c on c.owner_id = m.user_id and c.contact_id = new.sender_id
   where m.conversation_id = new.conversation_id
     and m.user_id <> new.sender_id
     and not coalesce(c.muted, false)
     and public.push_reachable(m.user_id);
  return new;
end;
$$;
drop trigger if exists chat_messages_push on public.chat_messages;
create trigger chat_messages_push after insert on public.chat_messages
  for each row execute function public.push_from_chat_message();

/* -------------------------------------------------------------- sending */

/**
 * Wakes the dispatcher, if this environment has one. Asynchronous: pg_net
 * sends after commit and nothing here waits for an answer.
 */
create or replace function public.push_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Once per transaction: a broadcast to everyone queues thousands of rows in one go, and wants one nudge, not thousands.
  if current_setting('jaxongirman.push_kicked', true) = 'on' then return; end if;
  perform set_config('jaxongirman.push_kicked', 'on', true);
  if not exists (select 1 from public.push_outbox where status in ('pending', 'sending')) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  -- A push is never worth failing the message or the notification it is about.
  return;
end;
$$;
revoke all on function public.push_kick() from public, anon, authenticated;

create or replace function public.push_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.push_kick();
  return null;
end;
$$;
drop trigger if exists push_outbox_kick on public.push_outbox;
create trigger push_outbox_kick after insert on public.push_outbox
  for each statement execute function public.push_outbox_kick();

/**
 * The dispatcher's batch: pending rows, and rows a crashed run left claimed
 * for over two minutes, each with the phones to send it to. Skip-locked, so
 * two runs never send the same row.
 */
create or replace function public.push_outbox_claim(p_limit integer default 200)
returns table (id bigint, title text, body text, data jsonb, channel text, tokens text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select o.id from public.push_outbox o
     where o.status = 'pending' or (o.status = 'sending' and o.claimed_at < now() - interval '2 minutes')
     order by o.id
     limit greatest(1, least(coalesce(p_limit, 200), 500))
     for update skip locked
  ), claimed as (
    update public.push_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
    returning o.id, o.user_id, o.title, o.body, o.data, o.channel, o.attempts
  )
  select c.id, c.title, c.body, c.data, c.channel,
         coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = c.user_id), '{}')
    from claimed c;
end;
$$;

/**
 * The dispatcher's report: what went, what failed (tried again up to three
 * times), and phones Expo says are gone, which are forgotten.
 */
create or replace function public.push_outbox_finish(p_sent bigint[], p_failed jsonb, p_dead_tokens text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_outbox set status = 'sent', sent_at = now(), error = null where id = any(coalesce(p_sent, '{}'));
  update public.push_outbox o set
    status = case when o.attempts >= 3 then 'failed' else 'pending' end,
    error = left(f.value, 300)
    from jsonb_each_text(coalesce(p_failed, '{}'::jsonb)) as f(key, value)
   where o.id = f.key::bigint;
  delete from public.push_tokens where token = any(coalesce(p_dead_tokens, '{}'));
  -- A week of history is enough to answer "did it go?".
  delete from public.push_outbox where status in ('sent', 'failed') and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.push_outbox_claim(integer) from public, anon, authenticated;
revoke all on function public.push_outbox_finish(bigint[], jsonb, text[]) from public, anon, authenticated;
grant execute on function public.push_outbox_claim(integer) to service_role;
grant execute on function public.push_outbox_finish(bigint[], jsonb, text[]) to service_role;

-- The minute nudge: a lost kick delays a push by a minute at most.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-dispatch') then
    perform cron.unschedule('push-dispatch');
  end if;
  perform cron.schedule('push-dispatch', '* * * * *', 'select public.push_kick()');
end;
$$;

/* ------------------------------------------------------------ broadcast */

/**
 * An administrator's message to everyone — a new version, a change worth
 * knowing — or to everyone using the app in one language. It is an ordinary
 * notification for each person, so it is in their list and, through the
 * trigger above, on their phone. Logged like every other administrator act.
 */
create or replace function public.admin_broadcast(p_title text, p_body text, p_deep_link text default null, p_language text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_title text := left(btrim(coalesce(p_title, '')), 160);
  v_body text := left(btrim(coalesce(p_body, '')), 500);
  v_link text := nullif(btrim(coalesce(p_deep_link, '')), '');
  v_count integer;
begin
  if v_admin is null or not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if char_length(v_title) < 1 then raise exception 'Sarlavhani yozing.' using errcode = '22023'; end if;
  if p_language is not null and p_language not in ('uz', 'ru', 'en', 'tr') then
    raise exception 'Til noto‘g‘ri.' using errcode = '22023';
  end if;
  insert into public.notifications (user_id, kind, title, body, deep_link)
  select p.id, 'system'::public.notification_kind, v_title, v_body, v_link
    from public.profiles p
   where p.status = 'active' and (p_language is null or p.preferred_language = p_language);
  get diagnostics v_count = row_count;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'broadcast', 'notifications', coalesce(p_language, 'all'),
          jsonb_build_object('title', v_title, 'body', v_body, 'deep_link', v_link, 'recipients', v_count));
  return v_count;
end;
$$;
revoke all on function public.admin_broadcast(text, text, text, text) from public, anon;
grant execute on function public.admin_broadcast(text, text, text, text) to authenticated;
