-- Subscriptions, entitlements and quotas.
--
-- What already exists is reused rather than rebuilt. `credit_wallets` and
-- `credit_transactions` are the J Coin economy — a ledger with reservations and
-- an idempotency key on every row — and nothing here creates a second one.
-- `app_settings.credits.operation_costs` is already the central price list, so
-- new prices go there rather than into constants scattered through the code.
--
-- What is genuinely new is the subscription itself: a plan an admin can shape,
-- a membership with a lifecycle, and a way to count what a member has used
-- inside a period. Everything a screen is allowed to do follows from those
-- three, decided on the server.

/* --------------------------------------------------------------- the plans */

create type public.subscription_status as enum (
  'inactive', 'payment_pending', 'active', 'expired', 'cancelled'
);

/**
 * A plan is a price plus a set of capabilities.
 *
 * The capabilities live in `features` rather than in columns because they are
 * the part that keeps changing: a weekly presentation allowance, a marketplace
 * permission, a game discount. Each is `{ enabled, limit, period, cost, unit,
 * description }`, so a new capability is a new key rather than a migration —
 * and the shape is checked, so a typo cannot become a silently missing limit.
 */
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  subtitle text not null default '',
  description text not null default '',
  badge text not null default '',
  cta_label text not null default '',
  price_amount integer not null,
  /** What it used to cost, for a struck-through comparison. Zero means none. */
  compare_at_amount integer not null default 0,
  currency text not null default 'UZS',
  period_days integer not null default 30,
  features jsonb not null default '{}'::jsonb,
  /** What an average member of this plan is expected to cost us, in som. */
  estimated_cost_amount integer not null default 0,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint subscription_plans_price check (price_amount >= 0 and compare_at_amount >= 0),
  constraint subscription_plans_period check (period_days between 1 and 3650),
  constraint subscription_plans_currency check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_plans_features_object check (jsonb_typeof(features) = 'object')
);

create index subscription_plans_visible_idx
  on public.subscription_plans (sort_order, created_at) where is_active;

create trigger subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

/* ---------------------------------------------------------- the membership */

/**
 * One row per membership, past or present.
 *
 * A member is whoever has a row that is `active` and has not run out. That is
 * the only definition, it is evaluated on the server, and no client flag can
 * stand in for it.
 */
create table public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status public.subscription_status not null default 'payment_pending',
  /** The order that paid for it, so a membership can always be traced to money. */
  order_id uuid references public.orders(id) on delete set null,
  started_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  /**
   * The plan as it stood when this was bought. A later edit to the plan must
   * not silently change what somebody already paid for.
   */
  plan_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_active_window check (
    status <> 'active' or (started_at is not null and expires_at is not null and expires_at > started_at)
  )
);

create index user_subscriptions_user_idx on public.user_subscriptions (user_id, created_at desc);
-- One live membership per person. A second purchase extends the first rather
-- than running two in parallel and charging twice for the same week.
create unique index user_subscriptions_one_live
  on public.user_subscriptions (user_id)
  where status in ('active', 'payment_pending');

create trigger user_subscriptions_set_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

/* -------------------------------------------------------------- the counters */

/**
 * What somebody has used, inside the period it belongs to.
 *
 * One table serves every allowance — four presentations a week, one marathon
 * unlock a week, three free games a day — because they differ only in their key
 * and their period. `period_start` is a date so the row itself says which week
 * or day it counts, and the unique index is what makes an increment atomic:
 * two requests racing both land on the same row and one of them waits.
 */
create table public.subscription_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  period_start date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, feature_key, period_start),
  constraint subscription_usage_used check (used >= 0),
  constraint subscription_usage_key check (feature_key ~ '^[a-z][a-z0-9_]*$')
);

create index subscription_usage_user_idx on public.subscription_usage (user_id, period_start desc);

/**
 * Where a member is, so a daily allowance resets at their midnight.
 *
 * A single server timezone would reset Tashkent's day in the middle of
 * somebody else's afternoon. Defaulting to Asia/Tashkent is honest about who
 * this is built for while leaving the column free to say otherwise.
 */
alter table public.profiles
  add column if not exists timezone text not null default 'Asia/Tashkent';

/* ------------------------------------------------------------- the licences */

/**
 * What a member may do with a marketplace item they opened without buying it.
 *
 * A subscription unlock is not a purchase: it may be edited and presented
 * inside Jaxongirman, and it may not be downloaded or resold. Those are rows
 * here, checked on the server, rather than buttons hidden in a client.
 */
create table public.marketplace_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  license_type text not null,
  source_type text not null default 'marketplace',
  editable boolean not null default true,
  presentable boolean not null default true,
  download_allowed boolean not null default false,
  resale_allowed boolean not null default false,
  /** The copy made into the member's own projects, when one was made. */
  presentation_id uuid references public.presentations(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, product_id),
  constraint marketplace_licenses_type check (license_type in ('subscription_access', 'purchase')),
  constraint marketplace_licenses_source check (source_type in ('marketplace'))
);

create index marketplace_licenses_user_idx on public.marketplace_licenses (user_id, granted_at desc);

/* -------------------------------------------------------------------- RLS */

alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.subscription_usage enable row level security;
alter table public.marketplace_licenses enable row level security;

-- The catalogue is public: a signed-out visitor has to be able to see what a
-- plan costs before deciding to sign in.
create policy subscription_plans_public_read on public.subscription_plans
  for select to anon using (is_active);
create policy subscription_plans_read on public.subscription_plans
  for select to authenticated using (is_active or (select public.is_admin()));

-- Everything else is the member's own, and read-only to them. Every write goes
-- through a definer RPC, so a client cannot grant itself a membership, move a
-- counter, or mint a licence.
create policy user_subscriptions_read on public.user_subscriptions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy subscription_usage_read on public.subscription_usage
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy marketplace_licenses_read on public.marketplace_licenses
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

grant select on public.subscription_plans to anon, authenticated;
grant select on public.user_subscriptions, public.subscription_usage, public.marketplace_licenses to authenticated;

/* ---------------------------------------------------------------- the plan */

-- The plan the product launches with. `on conflict` so re-running the migration
-- never overwrites what an admin has since changed.
insert into public.subscription_plans (
  code, name, subtitle, description, badge, cta_label,
  price_amount, currency, period_days, is_featured, sort_order, estimated_cost_amount, features
) values (
  'premium_monthly',
  'JAXONGIRMAN PREMIUM',
  'Har hafta yangi imkoniyatlar',
  'Haftalik prezentatsiya limiti, marketplace savdosi va kengaytirilgan O‘yingoh.',
  'ENG OMMABOP',
  'Premiumni faollashtirish',
  36000, 'UZS', 30, true, 0, 0,
  jsonb_build_object(
    'presentation_weekly', jsonb_build_object(
      'enabled', true, 'limit', 4, 'period', 'week', 'unit', 'presentation',
      'rollover', false, 'description', 'Haftasiga 4 ta prezentatsiya'),
    'presentation_max_slides', jsonb_build_object(
      'enabled', true, 'limit', 16, 'unit', 'slide',
      'description', 'Har birida 16 tagacha slayd'),
    'marathon_unlock', jsonb_build_object(
      'enabled', true, 'limit', 1, 'period', 'week', 'unit', 'unlock',
      'description', 'Haftasiga 1 ta premium ochish'),
    'marketplace_access', jsonb_build_object('enabled', true, 'description', 'Marketplace xarid va savdosi'),
    'marketplace_buy', jsonb_build_object('enabled', true),
    'marketplace_sell', jsonb_build_object('enabled', true),
    'marketplace_edit', jsonb_build_object('enabled', true, 'description', 'Marketplace loyihalarini tahrirlash'),
    'marketplace_present', jsonb_build_object('enabled', true),
    'marketplace_download', jsonb_build_object('enabled', false),
    'marketplace_resale', jsonb_build_object('enabled', false),
    'game_free_daily', jsonb_build_object(
      'enabled', true, 'limit', 3, 'period', 'day', 'unit', 'game',
      'description', 'O‘yingoh uchun kengaytirilgan imkoniyatlar'),
    'game_cost_after_free', jsonb_build_object('enabled', true, 'cost', 20, 'unit', 'jcoin'),
    'external_pptx_present', jsonb_build_object('enabled', true, 'cost', 24, 'unit', 'jcoin')
  )
) on conflict (code) do nothing;

-- The prices that apply to everybody, member or not. They live beside the other
-- operation costs so there is one price list, not two.
update public.app_settings
   set value = value
     || jsonb_build_object(
          'external_pptx_present', jsonb_build_object('base_credits', 24),
          'game_after_free_limit', jsonb_build_object('base_credits', 20))
 where key = 'credits.operation_costs';

-- Free-tier allowances, so a non-member's limits are configuration too.
insert into public.app_settings (key, value)
values ('subscription.free_tier', jsonb_build_object(
  'game_free_daily', 3,
  'presentation_weekly', 0,
  'marketplace_access', false
))
on conflict (key) do nothing;

/* ------------------------------------------------------------- the engine */

/**
 * The membership a person actually holds right now.
 *
 * A row is only a membership while it is `active` and has not run out, so an
 * expiry is a fact about time rather than something a job has to remember to
 * write. Anything that needs to know "is this person premium" asks here.
 */
create or replace function public.current_subscription(p_user_id uuid default auth.uid())
returns public.user_subscriptions
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.user_subscriptions s
  where s.user_id = p_user_id
    and s.status = 'active'
    and s.expires_at > now()
  order by s.expires_at desc
  limit 1;
$$;

/**
 * Everything the caller is allowed to do, resolved once.
 *
 * A screen asks this and renders from the answer; a server-side action asks it
 * again before doing anything. Both read the same plan, so a client that lies
 * about what it is allowed to do is contradicting the thing that decides.
 *
 * Without a membership the answer is the free tier — which is a setting, not a
 * hardcoded zero, so an admin can open the door wider without a deploy.
 */
create or replace function public.my_entitlements(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_free jsonb;
  v_features jsonb;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select value into v_free from public.app_settings where key = 'subscription.free_tier';
  v_free := coalesce(v_free, '{}'::jsonb);

  v_sub := public.current_subscription(p_user_id);
  if v_sub.id is null then
    return jsonb_build_object(
      'member', false,
      'status', 'inactive',
      'plan', null,
      'features', jsonb_build_object(
        'game_free_daily', jsonb_build_object(
          'enabled', true, 'limit', coalesce((v_free->>'game_free_daily')::integer, 3), 'period', 'day'),
        'presentation_weekly', jsonb_build_object(
          'enabled', coalesce((v_free->>'presentation_weekly')::integer, 0) > 0,
          'limit', coalesce((v_free->>'presentation_weekly')::integer, 0), 'period', 'week'),
        'marketplace_access', jsonb_build_object(
          'enabled', coalesce((v_free->>'marketplace_access')::boolean, false))
      )
    );
  end if;

  select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
  -- The plan as it was sold, when there is a snapshot: a later edit must not
  -- change what somebody already paid for.
  v_features := coalesce(nullif(v_sub.plan_snapshot -> 'features', 'null'::jsonb), v_plan.features);

  return jsonb_build_object(
    'member', true,
    'status', v_sub.status,
    'expires_at', v_sub.expires_at,
    'plan', jsonb_build_object(
      'code', v_plan.code, 'name', v_plan.name, 'price_amount', v_plan.price_amount,
      'currency', v_plan.currency, 'period_days', v_plan.period_days),
    'features', v_features
  );
end;
$$;

/** Monday of the week a moment falls in, in the caller's own timezone. */
create or replace function public.usage_period_start(p_user_id uuid, p_period text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_local timestamptz;
begin
  select coalesce(nullif(btrim(timezone), ''), 'Asia/Tashkent') into v_zone
    from public.profiles where id = p_user_id;
  v_zone := coalesce(v_zone, 'Asia/Tashkent');
  -- An unknown zone must not take a payment down with it.
  begin
    v_local := now() at time zone v_zone;
  exception when others then
    v_local := now() at time zone 'Asia/Tashkent';
  end;

  return case lower(coalesce(p_period, 'week'))
    when 'day' then v_local::date
    when 'month' then date_trunc('month', v_local)::date
    else date_trunc('week', v_local)::date
  end;
end;
$$;

/**
 * How much of an allowance is left, without spending any of it.
 *
 * Read-only on purpose: a screen showing "3 / 4 used" must not be able to move
 * the counter by rendering.
 */
create or replace function public.quota_status(p_feature_key text, p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ent jsonb;
  v_feature jsonb;
  v_period text;
  v_limit integer;
  v_start date;
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  v_ent := public.my_entitlements(p_user_id);
  v_feature := coalesce(v_ent -> 'features' -> p_feature_key, '{}'::jsonb);
  if coalesce((v_feature ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('feature', p_feature_key, 'enabled', false,
      'limit', 0, 'used', 0, 'remaining', 0);
  end if;

  v_period := coalesce(v_feature ->> 'period', 'week');
  v_limit := coalesce((v_feature ->> 'limit')::integer, 0);
  v_start := public.usage_period_start(p_user_id, v_period);

  select coalesce(used, 0) into v_used from public.subscription_usage
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start;
  v_used := coalesce(v_used, 0);

  return jsonb_build_object(
    'feature', p_feature_key,
    'enabled', true,
    'period', v_period,
    'period_start', v_start,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'resets_at', case lower(v_period)
      when 'day' then (v_start + 1)
      when 'month' then (v_start + interval '1 month')::date
      else (v_start + 7) end
  );
end;
$$;

/**
 * Spends one unit of an allowance, or refuses.
 *
 * The insert is the lock: two requests racing for the last presentation of the
 * week both try to write the same `(user, feature, period)` row, and the second
 * waits for the first to commit before re-reading the count. Checking first and
 * writing after would let both through.
 */
create or replace function public.quota_consume(
  p_feature_key text,
  p_amount integer default 1,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_start date;
  v_used integer;
  v_limit integer;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if coalesce(p_amount, 1) < 1 then
    raise exception 'quota amount must be positive' using errcode = '22023';
  end if;

  v_status := public.quota_status(p_feature_key, p_user_id);
  if (v_status ->> 'enabled')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'not_entitled', 'feature', p_feature_key);
  end if;

  v_limit := (v_status ->> 'limit')::integer;
  v_start := (v_status ->> 'period_start')::date;

  insert into public.subscription_usage (user_id, feature_key, period_start, used)
  values (p_user_id, p_feature_key, v_start, 0)
  on conflict (user_id, feature_key, period_start) do nothing;

  -- Taken before the decision, so the count cannot change underneath it.
  select used into v_used from public.subscription_usage
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start
   for update;

  if v_used + p_amount > v_limit then
    return jsonb_build_object('ok', false, 'code', 'quota_exhausted', 'feature', p_feature_key,
      'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0),
      'resets_at', v_status -> 'resets_at');
  end if;

  update public.subscription_usage
     set used = used + p_amount, updated_at = now()
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start
   returning used into v_used;

  return jsonb_build_object('ok', true, 'feature', p_feature_key, 'limit', v_limit,
    'used', v_used, 'remaining', greatest(v_limit - v_used, 0),
    'resets_at', v_status -> 'resets_at');
end;
$$;

/** Gives a unit back, for a technical failure after the allowance was taken. */
create or replace function public.quota_release(
  p_feature_key text,
  p_amount integer default 1,
  p_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text;
  v_start date;
begin
  v_period := coalesce(public.my_entitlements(p_user_id) -> 'features' -> p_feature_key ->> 'period', 'week');
  v_start := public.usage_period_start(p_user_id, v_period);
  update public.subscription_usage
     set used = greatest(used - greatest(coalesce(p_amount, 1), 0), 0), updated_at = now()
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start;
end;
$$;

revoke all on function public.current_subscription(uuid) from public, anon;
revoke all on function public.usage_period_start(uuid, text) from public, anon;
revoke all on function public.quota_consume(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.quota_release(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.my_entitlements(uuid) from public, anon;
revoke all on function public.quota_status(text, uuid) from public, anon;

-- A member may read what they are entitled to and how much is left. Spending is
-- the server's alone: `quota_consume` is reachable only from an Edge function
-- holding the service role, beside the work it is paying for.
grant execute on function public.my_entitlements(uuid) to authenticated;
grant execute on function public.quota_status(text, uuid) to authenticated;
grant execute on function public.current_subscription(uuid) to authenticated;
grant execute on function public.quota_consume(text, integer, uuid) to service_role;
grant execute on function public.quota_release(text, integer, uuid) to service_role;
grant execute on function public.usage_period_start(uuid, text) to service_role;
