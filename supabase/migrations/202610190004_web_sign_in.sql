-- Signing in on the website with the phone.
--
-- The site shows a QR code (after the same film the presenting screen plays);
-- the app scans it from Profil → "Web ulash", shows which browser is asking,
-- and the person allows it. The browser is then signed in to that account.
--
-- Nothing secret travels in the code. Opening a sign-in gives the browser two
-- things: a token, which goes into the QR and only identifies the request, and
-- a secret, which never leaves that browser. Approving (the `web-sign-in`
-- function, with the person's own session) mints a one-time magic-link hash
-- for their account and keeps it on the row. Only the browser holding the
-- secret can collect it, exactly once — the hash is wiped as it is handed over
-- — and it turns into a session with `verifyOtp`. A request lives for three
-- minutes; an approval nobody collected lives no longer.
--
-- The table has no policies: every read and write goes through the functions
-- below or the service role.

create table if not exists public.web_sign_in_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  secret_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'used', 'expired')),
  user_agent text,
  ip text,
  user_id uuid references auth.users(id) on delete cascade,
  otp_hash text,
  approved_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '3 minutes',
  created_at timestamptz not null default now()
);

create index if not exists web_sign_in_sessions_user on public.web_sign_in_sessions (user_id, approved_at desc);
create index if not exists web_sign_in_sessions_ip on public.web_sign_in_sessions (ip, created_at desc);

alter table public.web_sign_in_sessions enable row level security;
revoke all on public.web_sign_in_sessions from public, anon, authenticated;
-- The web-sign-in function reads the request and records the approval.
grant select, update on public.web_sign_in_sessions to service_role;

comment on table public.web_sign_in_sessions is
  'QR sign-in requests from the website; approved from the app (web-sign-in function), collected once by the browser that opened them.';

/** The address the request came from, as the API gateway saw it. */
create or replace function public.web_sign_in_client_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
$$;

/**
 * A new sign-in request for this browser: the token for the QR and the secret
 * the browser keeps. Old rows are swept on the way; one address may not open
 * more than thirty in ten minutes.
 */
create or replace function public.web_sign_in_open(p_user_agent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(18), 'hex');
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_ip text := public.web_sign_in_client_ip();
  v_row public.web_sign_in_sessions%rowtype;
begin
  delete from public.web_sign_in_sessions where expires_at < now() - interval '1 day';

  if v_ip is not null and (
    select count(*) from public.web_sign_in_sessions
     where ip = v_ip and created_at > now() - interval '10 minutes'
  ) >= 30 then
    raise exception 'Juda ko‘p urinish. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.'
      using errcode = '54000', detail = 'rate_limited';
  end if;

  insert into public.web_sign_in_sessions (token_hash, secret_hash, user_agent, ip)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_secret, 'sha256'), 'hex'),
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300),
    v_ip
  )
  returning * into v_row;

  return jsonb_build_object('session_id', v_row.id, 'token', v_token, 'secret', v_secret, 'expires_at', v_row.expires_at);
end;
$$;

/**
 * Where the browser's request stands. When the phone has allowed it, the
 * one-time hash is handed over and wiped in the same statement, so a second
 * collect — or anybody else's — finds nothing.
 */
create or replace function public.web_sign_in_collect(p_session_id uuid, p_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.web_sign_in_sessions%rowtype;
  v_hash text;
begin
  select * into v_row from public.web_sign_in_sessions
   where id = p_session_id
     and secret_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
   for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  if v_row.status = 'approved' and v_row.otp_hash is not null and v_row.expires_at > now() then
    v_hash := v_row.otp_hash;
    update public.web_sign_in_sessions
       set status = 'used', used_at = now(), otp_hash = null
     where id = v_row.id;
    return jsonb_build_object('status', 'approved', 'token_hash', v_hash);
  end if;

  if v_row.status in ('pending', 'approved') and v_row.expires_at <= now() then
    update public.web_sign_in_sessions set status = 'expired', otp_hash = null where id = v_row.id;
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object('status', v_row.status);
end;
$$;

/** The browsers this person let in, newest first, for the app's "Web ulash" screen. */
create or replace function public.web_sign_in_history()
returns table (approved_at timestamptz, used_at timestamptz, user_agent text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.approved_at, s.used_at, s.user_agent
    from public.web_sign_in_sessions s
   where s.user_id = auth.uid() and s.approved_at is not null
   order by s.approved_at desc
   limit 20;
$$;

revoke all on function public.web_sign_in_client_ip() from public, anon, authenticated;
revoke all on function public.web_sign_in_open(text) from public;
revoke all on function public.web_sign_in_collect(uuid, text) from public;
revoke all on function public.web_sign_in_history() from public, anon;
grant execute on function public.web_sign_in_open(text) to anon, authenticated;
grant execute on function public.web_sign_in_collect(uuid, text) to anon, authenticated;
grant execute on function public.web_sign_in_history() to authenticated;
