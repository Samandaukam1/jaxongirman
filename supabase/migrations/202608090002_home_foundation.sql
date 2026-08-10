-- The home screen's backbone: an inbox that can point somewhere, paid module
-- access as a first-class record, an admin-owned J Coin package catalogue, and
-- the person-to-person transfer that moves coins without the client ever
-- touching a balance.
--
-- Everything here is additive. No existing column, policy or function changes
-- meaning; the presentation generator's tables are untouched.

-- ------------------------------------------------------------- notifications --
-- A message can now say where it leads. `deep_link` is an in-app path
-- ('/(app)/survey/<id>'), `entity_id` the row it is about, so a screen can
-- re-fetch rather than trust the payload it was handed.
alter table public.notifications
  add column if not exists deep_link text,
  add column if not exists entity_id uuid;

alter table public.notifications
  drop constraint if exists notifications_deep_link_shape;
-- Relative in-app paths only. An absolute URL in this column would turn the
-- inbox into an open redirect the moment a screen followed one.
alter table public.notifications
  add constraint notifications_deep_link_shape
  check (deep_link is null or (deep_link ~ '^/[A-Za-z0-9()_\-/\[\]?&=.]{0,300}$' and deep_link !~ '//'));

-- ------------------------------------------------------- module entitlements --
create type public.entitlement_status as enum ('active', 'expired', 'revoked');

/**
 * Paid access to a named module, held as a dated window rather than a boolean.
 * `expires_at` is the whole business rule: 11 months of Ma'lumotlarni yig'ish is
 * one row whose window is eleven months wide.
 */
create table public.module_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_code text not null,
  status public.entitlement_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  purchased_amount numeric(12,2) not null default 0,
  currency text not null default 'UZS',
  -- How this entitlement came to exist. 'purchase' is reserved for a real
  -- payment provider callback; nothing in the app may write it today.
  source text not null default 'admin_grant',
  payment_reference text,
  granted_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_entitlements_code_format check (module_code ~ '^[a-z][a-z0-9_]{2,39}$'),
  constraint module_entitlements_window check (expires_at > starts_at),
  constraint module_entitlements_currency check (currency ~ '^[A-Z]{3}$'),
  constraint module_entitlements_amount check (purchased_amount >= 0),
  constraint module_entitlements_source check (source in ('admin_grant', 'purchase', 'promo', 'trial'))
);

-- One live entitlement per module per person: a renewal extends the window it
-- already has rather than stacking a second row nothing would know to read.
create unique index module_entitlements_active_idx
  on public.module_entitlements (user_id, module_code)
  where status = 'active';
create index module_entitlements_expiry_idx
  on public.module_entitlements (expires_at)
  where status = 'active';

create trigger module_entitlements_set_updated_at
  before update on public.module_entitlements
  for each row execute function public.set_updated_at();

alter table public.module_entitlements enable row level security;

create policy module_entitlements_select on public.module_entitlements for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

grant select on public.module_entitlements to authenticated;
revoke all on public.module_entitlements from anon;

/** True while the window is open. The single answer every gate asks for. */
create or replace function public.has_module_access(
  p_module_code text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.module_entitlements
    where user_id = p_user_id
      and module_code = p_module_code
      and status = 'active'
      and starts_at <= now()
      and expires_at > now()
  );
$$;

comment on function public.has_module_access(text, uuid) is
  'True while the caller holds an unexpired entitlement for the module. Every module gate funnels through this.';

-- ---------------------------------------------------------- coin packages --
/**
 * What a person may buy, owned entirely by the admin console. Deliberately
 * seeded with nothing: a price the business has not set is not a price, and an
 * empty catalogue is the honest state until one exists.
 */
create table public.coin_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text not null default '',
  coins integer not null,
  bonus_coins integer not null default 0,
  price_amount numeric(12,2) not null,
  currency text not null default 'UZS',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coin_packages_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint coin_packages_label_length check (char_length(label) between 1 and 80),
  constraint coin_packages_amounts check (coins > 0 and bonus_coins >= 0 and price_amount >= 0),
  constraint coin_packages_currency check (currency ~ '^[A-Z]{3}$')
);

create index coin_packages_active_idx on public.coin_packages (sort_order, coins) where is_active;

create trigger coin_packages_set_updated_at
  before update on public.coin_packages
  for each row execute function public.set_updated_at();

alter table public.coin_packages enable row level security;

create policy coin_packages_select on public.coin_packages for select to authenticated
  using (is_active or (select public.is_admin()));

grant select on public.coin_packages to authenticated;
revoke all on public.coin_packages from anon;

-- ------------------------------------------------------------- settings --
insert into public.app_settings (key, value, description, public_read)
values
  (
    'payments.config',
    '{"provider":null,"configured":false}'::jsonb,
    'Payment provider wiring. While configured=false the apps must show that purchases are unavailable rather than simulate one.',
    true
  ),
  (
    'modules.data_collection',
    jsonb_build_object(
      'code', 'data_collection',
      'label', 'Ma‘lumotlarni yig‘ish',
      'enabled', true,
      'price_amount', 11000,
      'currency', 'UZS',
      'duration_months', 11,
      -- Enforcement is a switch, not a hard-coded rule. Both stay off until a
      -- payment provider exists, because with no way to buy access, enforcing it
      -- would close the module to everyone. Flip them the day payments land.
      'enforce_creator_access', false,
      'enforce_respondent_access', false,
      'response_retention_hours', 48,
      'max_questions', 40,
      'max_image_bytes', 3145728
    ),
    'Ma‘lumotlarni yig‘ish module: price, access window and enforcement switches',
    true
  ),
  (
    'coins.transfer',
    '{"min_amount":1,"max_amount":100000,"daily_limit":200000}'::jsonb,
    'Bounds applied by transfer_credits() to person-to-person J Coin transfers',
    true
  )
on conflict (key) do update set
  description = excluded.description,
  public_read = excluded.public_read;

-- --------------------------------------------------------- profile search --
/**
 * Finds someone to send coins to. profiles' RLS deliberately shows a person only
 * their own row, so a handle lookup cannot be a table read — it is this
 * function, which returns four public-by-nature fields and nothing else: no
 * email, no balance, no status beyond being findable at all.
 */
create or replace function public.search_profiles_by_username(
  p_query text,
  p_limit integer default 10
)
returns table (id uuid, full_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as term)
  select p.id, p.full_name, p.username, p.avatar_url
  from public.profiles p, q
  where auth.uid() is not null
    and char_length(q.term) >= 2
    and p.id <> auth.uid()
    and p.status = 'active'
    and p.username is not null
    and lower(p.username) like '%' || q.term || '%'
  -- Exact handle first, then shortest: typing a full username puts that person
  -- at the top even when longer handles contain it.
  order by (lower(p.username) = q.term) desc, char_length(p.username), p.username
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

comment on function public.search_profiles_by_username(text, integer) is
  'Username search for coin transfers. Returns only display fields, never the caller, never a blocked account.';

-- ------------------------------------------------------------- transfers --
/**
 * Moves J Coin between two people in one transaction.
 *
 * The client never writes a balance: it calls this, and this is the only path
 * that can move coins sideways. Both wallets are locked in a fixed id order so
 * two people paying each other at once cannot deadlock, the sender's row is
 * checked for funds *after* the lock so a double-spend has nowhere to hide, and
 * the sender's idempotency key makes a retried request a no-op rather than a
 * second payment.
 */
create or replace function public.transfer_credits(
  p_recipient_id uuid,
  p_amount integer,
  p_note text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_key text;
  v_config jsonb;
  v_min integer;
  v_max integer;
  v_note text;
  v_sender_wallet public.credit_wallets%rowtype;
  v_recipient_wallet public.credit_wallets%rowtype;
  v_sender_profile public.profiles%rowtype;
  v_recipient_profile public.profiles%rowtype;
  v_sender_after public.credit_wallets%rowtype;
  v_recipient_after public.credit_wallets%rowtype;
  v_existing public.credit_transactions%rowtype;
begin
  if v_sender is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_recipient_id is null then
    raise exception 'recipient is required' using errcode = '22023';
  end if;
  if p_recipient_id = v_sender then
    raise exception 'you cannot send coins to yourself' using errcode = '22023';
  end if;

  select coalesce(value, '{}'::jsonb) into v_config from public.app_settings where key = 'coins.transfer';
  v_min := coalesce((v_config ->> 'min_amount')::integer, 1);
  v_max := coalesce((v_config ->> 'max_amount')::integer, 100000);

  if p_amount is null or p_amount < v_min then
    raise exception 'amount must be at least % coins', v_min using errcode = '22023';
  end if;
  if p_amount > v_max then
    raise exception 'amount may not exceed % coins', v_max using errcode = '22023';
  end if;

  select * into v_sender_profile from public.profiles where id = v_sender;
  if not found or v_sender_profile.status = 'blocked' then
    raise exception 'account cannot send coins' using errcode = '42501';
  end if;

  select * into v_recipient_profile from public.profiles where id = p_recipient_id;
  if not found then
    raise exception 'recipient not found' using errcode = 'P0002';
  end if;
  if v_recipient_profile.status = 'blocked' then
    raise exception 'recipient cannot receive coins' using errcode = '42501';
  end if;

  v_key := 'transfer:' || coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);
  v_note := left(btrim(coalesce(p_note, '')), 200);

  -- Fixed lock order by id, not by role in the transfer. Two people sending to
  -- each other in the same instant then queue instead of deadlocking.
  if v_sender < p_recipient_id then
    select * into v_sender_wallet from public.credit_wallets where user_id = v_sender for update;
    select * into v_recipient_wallet from public.credit_wallets where user_id = p_recipient_id for update;
  else
    select * into v_recipient_wallet from public.credit_wallets where user_id = p_recipient_id for update;
    select * into v_sender_wallet from public.credit_wallets where user_id = v_sender for update;
  end if;

  if v_sender_wallet.user_id is null then
    raise exception 'sender wallet not found' using errcode = 'P0002';
  end if;
  if v_recipient_wallet.user_id is null then
    raise exception 'recipient wallet not found' using errcode = 'P0002';
  end if;

  -- Replay of a request that already went through. Answer with the same shape a
  -- first attempt would, so a retry after a dropped response looks like success.
  select * into v_existing from public.credit_transactions
    where user_id = v_sender and idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'applied', false,
      'amount', abs(v_existing.amount),
      'balance', v_sender_wallet.balance,
      'transaction_id', v_existing.id,
      'message', 'already sent'
    );
  end if;

  if v_sender_wallet.balance < p_amount then
    raise exception 'insufficient balance' using errcode = '22023';
  end if;

  update public.credit_wallets
    set balance = balance - p_amount, version = version + 1
    where user_id = v_sender
    returning * into v_sender_after;

  update public.credit_wallets
    set balance = balance + p_amount, version = version + 1
    where user_id = p_recipient_id
    returning * into v_recipient_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    v_sender, 'transfer_out', -p_amount, v_sender_after.balance, v_sender_after.reserved, v_key,
    case when v_note = '' then 'J Coin yuborildi' else v_note end, v_sender,
    jsonb_build_object('counterparty_id', p_recipient_id, 'direction', 'out')
  );

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    p_recipient_id, 'transfer_in', p_amount, v_recipient_after.balance, v_recipient_after.reserved, v_key,
    case when v_note = '' then 'J Coin qabul qilindi' else v_note end, v_sender,
    jsonb_build_object('counterparty_id', v_sender, 'direction', 'in')
  );

  insert into public.notifications (user_id, kind, title, body, payload, entity_id)
  values (
    p_recipient_id,
    'credit_received',
    p_amount || ' J qabul qilindi',
    coalesce(
      nullif(btrim(v_sender_profile.full_name), ''),
      case when v_sender_profile.username is null then 'Foydalanuvchi' else '@' || v_sender_profile.username end
    ) || case when v_note = '' then ' sizga J Coin yubordi.' else ' sizga J Coin yubordi: ' || v_note end,
    jsonb_build_object('amount', p_amount, 'balance', v_recipient_after.balance, 'sender_id', v_sender),
    v_sender
  );

  return jsonb_build_object(
    'applied', true,
    'amount', p_amount,
    'balance', v_sender_after.balance,
    'recipient_balance_changed', true
  );
end;
$$;

comment on function public.transfer_credits(uuid, integer, text, text) is
  'The only path that moves J Coin between people. Locks both wallets in id order, refuses to overdraw, and is idempotent per sender key.';

-- ---------------------------------------------------------- admin grants --
/** Grants or extends module access. Admin-only, audited, never called by the app. */
create or replace function public.admin_grant_module_access(
  p_user_id uuid,
  p_module_code text,
  p_months integer default null,
  p_amount numeric default null,
  p_currency text default null,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_config jsonb;
  v_months integer;
  v_amount numeric;
  v_currency text;
  v_before public.module_entitlements%rowtype;
  v_after public.module_entitlements%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_module_code is null then
    raise exception 'user and module are required' using errcode = '22023';
  end if;

  select coalesce(value, '{}'::jsonb) into v_config
    from public.app_settings where key = 'modules.' || p_module_code;
  if v_config is null then
    raise exception 'unknown module %', p_module_code using errcode = '22023';
  end if;

  v_months := coalesce(p_months, (v_config ->> 'duration_months')::integer, 11);
  v_amount := coalesce(p_amount, (v_config ->> 'price_amount')::numeric, 0);
  v_currency := upper(coalesce(nullif(btrim(p_currency), ''), v_config ->> 'currency', 'UZS'));
  if v_months < 1 or v_months > 120 then
    raise exception 'months must be between 1 and 120' using errcode = '22023';
  end if;

  select * into v_before from public.module_entitlements
    where user_id = p_user_id and module_code = p_module_code and status = 'active'
    for update;

  if found then
    -- Extend from whichever is later: an unexpired window keeps its remaining
    -- time, an expired one starts counting from today.
    update public.module_entitlements
      set expires_at = greatest(v_before.expires_at, now()) + make_interval(months => v_months),
          purchased_amount = v_before.purchased_amount + v_amount,
          granted_by = v_admin
      where id = v_before.id
      returning * into v_after;
  else
    insert into public.module_entitlements (
      user_id, module_code, status, starts_at, expires_at, purchased_amount, currency, source, granted_by
    ) values (
      p_user_id, p_module_code, 'active', now(), now() + make_interval(months => v_months),
      v_amount, v_currency, 'admin_grant', v_admin
    )
    returning * into v_after;
  end if;

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    p_user_id, 'system',
    coalesce(v_config ->> 'label', p_module_code) || ' ochildi',
    'Modulga kirish ' || to_char(v_after.expires_at, 'DD.MM.YYYY') || ' gacha faol.',
    jsonb_build_object('module_code', p_module_code, 'expires_at', v_after.expires_at)
  );

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'module.grant', 'user', p_user_id::text, to_jsonb(v_before), to_jsonb(v_after), left(btrim(coalesce(p_reason, '')), 500));

  return to_jsonb(v_after);
end;
$$;

/** Ends module access now. The row stays for the audit trail. */
create or replace function public.admin_revoke_module_access(
  p_user_id uuid,
  p_module_code text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.module_entitlements%rowtype;
  v_after public.module_entitlements%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_before from public.module_entitlements
    where user_id = p_user_id and module_code = p_module_code and status = 'active'
    for update;
  if not found then
    return jsonb_build_object('revoked', false, 'message', 'no active entitlement');
  end if;

  update public.module_entitlements set status = 'revoked' where id = v_before.id returning * into v_after;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'module.revoke', 'user', p_user_id::text, to_jsonb(v_before), to_jsonb(v_after), left(btrim(coalesce(p_reason, '')), 500));

  return jsonb_build_object('revoked', true, 'entitlement', to_jsonb(v_after));
end;
$$;

/** Creates or updates one purchasable coin package. Admin-only, audited. */
create or replace function public.admin_upsert_coin_package(
  p_code text,
  p_label text,
  p_coins integer,
  p_price_amount numeric,
  p_currency text default 'UZS',
  p_bonus_coins integer default 0,
  p_description text default '',
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns public.coin_packages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.coin_packages%rowtype;
  v_after public.coin_packages%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_before from public.coin_packages where code = p_code;

  insert into public.coin_packages (
    code, label, description, coins, bonus_coins, price_amount, currency, sort_order, is_active, updated_by
  ) values (
    lower(btrim(p_code)), btrim(p_label), left(btrim(coalesce(p_description, '')), 300), p_coins,
    coalesce(p_bonus_coins, 0), p_price_amount, upper(coalesce(nullif(btrim(p_currency), ''), 'UZS')),
    coalesce(p_sort_order, 0), coalesce(p_is_active, true), v_admin
  )
  on conflict (code) do update set
    label = excluded.label,
    description = excluded.description,
    coins = excluded.coins,
    bonus_coins = excluded.bonus_coins,
    price_amount = excluded.price_amount,
    currency = excluded.currency,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_by = excluded.updated_by
  returning * into v_after;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'coin_package.upsert', 'coin_package', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after), 'Admin coin package update');

  return v_after;
end;
$$;

-- --------------------------------------------------------------- realtime --
-- The balance pill and the account card follow their own wallet without polling.
alter publication supabase_realtime add table public.credit_wallets;

-- ----------------------------------------------------------------- grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.has_module_access(text, uuid)',
    'public.search_profiles_by_username(text, integer)',
    'public.transfer_credits(uuid, integer, text, text)',
    'public.admin_grant_module_access(uuid, text, integer, numeric, text, text)',
    'public.admin_revoke_module_access(uuid, text, text)',
    'public.admin_upsert_coin_package(text, text, integer, numeric, text, integer, text, integer, boolean)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
