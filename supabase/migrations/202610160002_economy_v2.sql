/**
 * The J Tanga economy, second edition.
 *
 * What a presentation costs is now a price per page, set by the operator and
 * scaled by the buyer's tariff, and paid in this order: the welcome pages a
 * new account is given, then presentation pages bought as such, then J Tanga.
 * Three monthly tariffs — OSON, MAZZA, BEMALOL — grant J Tanga that burn at the
 * end of the month unless the tariff is renewed, in which case what is left
 * carries into the new month. A fixed product sells ten presentation pages for
 * the price of a ten-page deck, whatever the buyer's tariff.
 *
 * The pieces, all in this file:
 *
 *   economy_versions, service_prices   the operator's prices, versioned; a
 *                                      charge records the version it used
 *   subscription_plans (+columns)      what each tariff grants and its rate
 *   coin_lots                          a tariff's J Tanga for one month: how
 *                                      much of the wallet's balance is still
 *                                      them, and when they burn
 *   presentation_credit_grants/_ledger welcome and bought presentation pages
 *   welcome_claims                     one welcome per real identity, ever
 *   coin_packages (+columns)           J Tanga packs and the 10-page product
 *
 * J Tanga stay whole numbers. A charge in J Tanga is rounded once, at the
 * moment it is quoted, by the version's rounding rule, and stored; nothing is
 * recomputed from a later price.
 *
 * The wallet itself is unchanged: `credit_wallets.balance` is still the one
 * spendable figure, and a coin lot is a label on part of it, never a second
 * balance. So nothing that already spends J Tanga needs to know about tariffs
 * for the money to be right; the trigger below keeps the label honest.
 */

/* ------------------------------------------------------- price versions */

create table public.economy_versions (
  id bigserial primary key,
  version integer not null unique,
  -- What one J Tanga is worth in som, for accounting and AI-priced services.
  -- It is the coin packages' own price per coin, so a J Tanga is worth the
  -- same wherever it is counted.
  coin_value_uzs numeric(14, 4) not null check (coin_value_uzs > 0),
  rounding text not null default 'ceil' check (rounding in ('ceil', 'round', 'floor')),
  -- The page rate's multiplier for someone with no coin tariff.
  no_plan_multiplier numeric(24, 15) not null check (no_plan_multiplier > 0),
  min_charge integer not null default 1 check (min_charge >= 0),
  max_charge integer not null default 100000 check (max_charge > 0),
  -- {enabled, pages, expires_days, eligible_from, retroactive}
  welcome jsonb not null default '{}'::jsonb,
  note text not null default '',
  effective_from timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint economy_versions_charge_range check (min_charge <= max_charge)
);

comment on table public.economy_versions is
  'The operator''s economy settings, one row per published version. The active version is the newest whose effective_from has passed. Rows are never edited: a change publishes a new version.';

create table public.service_prices (
  id bigserial primary key,
  version_id bigint not null references public.economy_versions(id) on delete cascade,
  service text not null check (service in ('presentation', 'game', 'cv', 'article', 'independent_work')),
  -- page and question are priced per unit; ai_cost from the provider's bill.
  unit text not null check (unit in ('page', 'question', 'ai_cost')),
  coins_per_unit numeric(14, 4) not null default 0 check (coins_per_unit >= 0),
  ai_markup numeric(8, 4) not null default 1 check (ai_markup > 0),
  min_units integer not null default 1 check (min_units >= 0),
  max_units integer not null default 100 check (max_units >= 1),
  min_charge integer not null default 0 check (min_charge >= 0),
  max_charge integer not null default 100000 check (max_charge > 0),
  promo_percent numeric(5, 2) not null default 0 check (promo_percent >= 0 and promo_percent < 100),
  promo_until timestamptz,
  is_enabled boolean not null default true,
  unique (version_id, service),
  constraint service_prices_units check (min_units <= max_units),
  constraint service_prices_charge check (min_charge <= max_charge)
);

alter table public.economy_versions enable row level security;
alter table public.service_prices enable row level security;

-- Prices are public: a person is entitled to read what something will cost.
create policy economy_versions_read on public.economy_versions for select to authenticated, anon using (true);
create policy service_prices_read on public.service_prices for select to authenticated, anon using (true);

insert into public.economy_versions (version, coin_value_uzs, rounding, no_plan_multiplier, min_charge, max_charge, welcome, note)
values (
  1,
  29,                              -- 2 900 som per 100 J Tanga, the packages' rate
  'ceil',
  41800::numeric / 34000,          -- OSON's rate: no tariff is never cheaper than the cheapest one
  1,
  100000,
  jsonb_build_object(
    'enabled', true,
    'pages', 30,
    'expires_days', null,
    -- Only accounts created from here on: existing ones are not given it
    -- retroactively unless an operator turns that on.
    'eligible_from', to_jsonb(now()),
    'retroactive', false
  ),
  'Ikkinchi iqtisod: sahifa narxi, OSON/MAZZA/BEMALOL, 30 sahifalik bonus.'
);

insert into public.service_prices (version_id, service, unit, coins_per_unit, ai_markup, min_units, max_units, min_charge, max_charge)
select v.id, s.service, s.unit, s.per_unit, s.markup, s.min_units, s.max_units, s.min_charge, s.max_charge
from public.economy_versions v
cross join (values
  ('presentation', 'page', 10::numeric, 1::numeric, 3, 30, 0, 100000),
  ('game', 'question', 5::numeric, 1::numeric, 3, 60, 0, 100000),
  ('cv', 'ai_cost', 0::numeric, 3::numeric, 1, 1, 5, 300),
  ('article', 'ai_cost', 0::numeric, 3::numeric, 1, 1, 10, 600),
  ('independent_work', 'ai_cost', 0::numeric, 3::numeric, 1, 1, 20, 1500)
) as s(service, unit, per_unit, markup, min_units, max_units, min_charge, max_charge)
where v.version = 1;

/** The version in force now. */
create or replace function public.economy_current()
returns public.economy_versions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.economy_versions
  where effective_from <= now()
  order by effective_from desc, version desc
  limit 1;
$$;

/** One service's price in the version in force now. */
create or replace function public.service_price(p_service text)
returns public.service_prices
language sql
stable
security definer
set search_path = ''
as $$
  select sp.* from public.service_prices sp
  where sp.version_id = (public.economy_current()).id
    and sp.service = p_service;
$$;

/** A J Tanga amount rounded by the version's rule. */
create or replace function public.coins_round(p_amount numeric, p_rule text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_rule
    when 'floor' then floor(p_amount)
    when 'round' then round(p_amount)
    else ceil(p_amount)
  end::integer;
$$;

/* ---------------------------------------------------------------- plans */

alter table public.subscription_plans
  add column if not exists billing_model text not null default 'quota',
  add column if not exists included_coins integer not null default 0,
  add column if not exists presentation_units integer not null default 0,
  add column if not exists pages_per_unit integer not null default 10,
  add column if not exists page_multiplier numeric(24, 15) not null default 1,
  add column if not exists name_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists badge_i18n jsonb not null default '{}'::jsonb,
  add column if not exists is_visible boolean not null default true;

alter table public.subscription_plans
  add constraint subscription_plans_billing_model check (billing_model in ('quota', 'coins')),
  add constraint subscription_plans_included_coins check (included_coins >= 0),
  add constraint subscription_plans_units check (presentation_units >= 0 and pages_per_unit > 0),
  add constraint subscription_plans_multiplier check (page_multiplier > 0);

comment on column public.subscription_plans.billing_model is
  'quota: the original PREMIUM, a weekly count of presentations. coins: a monthly grant of J Tanga spent at the plan''s page_multiplier.';

/**
 * The three tariffs. Each multiplier is the plan's price per page against
 * BEMALOL's, as exact fractions:
 *
 *   OSON     190 som/page  ÷ (34 000/220) = 41 800 / 34 000
 *   MAZZA    (26 000/150)  ÷ (34 000/220) = 5 720 000 / 5 100 000
 *   BEMALOL  1
 *
 * and each grants exactly its allowance of ten-page decks at its own rate,
 * a deck rounded up as it is charged: OSON 10 × 123, MAZZA 15 × 113,
 * BEMALOL 22 × 100.
 */
do $$
declare
  v_features jsonb;
  v_rule text := 'ceil';
begin
  -- A coin tariff keeps the old tariff's perks except its weekly count.
  select coalesce(features, '{}'::jsonb) - 'presentation_weekly' - 'presentation_max_slides'
    into v_features
    from public.subscription_plans where code = 'premium_monthly';
  v_features := coalesce(v_features, '{}'::jsonb);

  insert into public.subscription_plans (
    code, name, subtitle, description, badge, cta_label, price_amount, compare_at_amount,
    currency, period_days, features, estimated_cost_amount, is_active, is_featured, sort_order,
    billing_model, included_coins, presentation_units, pages_per_unit, page_multiplier,
    name_i18n, description_i18n, badge_i18n, is_visible
  )
  select p.code, p.name, p.subtitle, p.subtitle, p.badge, 'Tanlash', p.price, 0,
         'UZS', 30, v_features, 0, true, p.featured, p.sort_order,
         'coins', p.units * public.coins_round(10 * 10 * p.multiplier, v_rule), p.units, 10, p.multiplier,
         jsonb_build_object('uz', p.name, 'en', p.name, 'ru', p.name),
         jsonb_build_object('uz', p.subtitle, 'en', p.subtitle_en, 'ru', p.subtitle_ru),
         case when p.badge = '' then '{}'::jsonb
              else jsonb_build_object('uz', p.badge, 'en', p.badge_en, 'ru', p.badge_ru) end,
         true
  from (values
    ('oson', 'OSON', 'Kundalik vazifalar uchun.', 'For everyday tasks.', 'Для повседневных задач.',
     '', '', '', 19000, 10, 41800::numeric / 34000, false, 10),
    ('mazza', 'MAZZA', 'Ko‘proq yarating, ko‘proq foydalaning.', 'Create more, use more.', 'Создавайте больше, пользуйтесь больше.',
     'Eng ommabop', 'Most popular', 'Самый популярный', 26000, 15, 5720000::numeric / 5100000, true, 20),
    ('bemalol', 'BEMALOL', 'Eng katta imkoniyatlar bir tarifda.', 'The most in one plan.', 'Максимум возможностей в одном тарифе.',
     'Eng tejamkor', 'Best value', 'Самый выгодный', 34000, 22, 1::numeric, false, 30)
  ) as p(code, name, subtitle, subtitle_en, subtitle_ru, badge, badge_en, badge_ru, price, units, multiplier, featured, sort_order)
  on conflict (code) do nothing;

  -- PREMIUM is no longer sold; those who hold it keep it until it ends.
  update public.subscription_plans
     set is_active = false, is_visible = false, billing_model = 'quota'
   where code = 'premium_monthly';
end;
$$;

/* ------------------------------------------------------------ coin lots */

create table public.coin_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.user_subscriptions(id) on delete set null,
  order_id uuid unique references public.orders(id) on delete set null,
  plan_code text not null,
  granted integer not null check (granted >= 0),
  -- Carried in from the lot it replaced, or converted from PREMIUM's count.
  rolled_in integer not null default 0 check (rolled_in >= 0),
  -- How much of the wallet's balance is still this lot's J Tanga.
  remaining integer not null check (remaining >= 0),
  status text not null default 'active' check (status in ('active', 'rolled', 'expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  burned integer not null default 0 check (burned >= 0),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coin_lots_remaining check (remaining <= granted + rolled_in)
);

create unique index coin_lots_one_active on public.coin_lots(user_id) where status = 'active';
create index coin_lots_due on public.coin_lots(expires_at) where status = 'active';

alter table public.coin_lots enable row level security;
create policy coin_lots_own on public.coin_lots for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

/**
 * Keeps a lot's `remaining` true as the wallet moves.
 *
 * Every row that takes J Tanga out of the balance takes them from the
 * tariff's lot first — they are the ones that will burn — and every refund or
 * release of a reservation puts back what that reservation took from it. The
 * lot is only a label on the balance, so a mistake here can change how much
 * burns at the month's end, never how much anybody holds.
 *
 * It also keeps a tariff's J Tanga with the person who bought the tariff: a
 * transfer may send what they bought or earned, never this month's tariff.
 */
create or replace function public.coin_lot_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coin_lots%rowtype;
  v_take integer;
  v_taken integer;
begin
  if new.type in ('plan_grant'::public.credit_transaction_type, 'plan_expiry'::public.credit_transaction_type)
     or new.amount = 0 then
    return new;
  end if;

  select * into v_lot from public.coin_lots
   where user_id = new.user_id and status = 'active'
   for update;
  if not found then return new; end if;

  if new.type = 'transfer_out'::public.credit_transaction_type then
    if new.balance_after < v_lot.remaining then
      raise exception 'Tarif J Tangalarini boshqa foydalanuvchiga o‘tkazib bo‘lmaydi. O‘tkazish mumkin: % J.',
        greatest(new.balance_after - new.amount - v_lot.remaining, 0)
        using errcode = 'P0001', detail = 'plan_coins_not_transferable';
    end if;
    return new;
  end if;

  if new.amount < 0 then
    v_take := least(v_lot.remaining, -new.amount);
    if v_take > 0 then
      update public.coin_lots set remaining = remaining - v_take where id = v_lot.id;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('plan_coins', v_take, 'lot_id', v_lot.id);
    end if;
  elsif new.type in ('refund'::public.credit_transaction_type, 'release'::public.credit_transaction_type,
                     'game_reward_refund'::public.credit_transaction_type) then
    select coalesce(sum((r.metadata ->> 'plan_coins')::integer), 0) into v_taken
      from public.credit_transactions r
     where r.user_id = new.user_id
       and r.amount < 0
       and r.metadata ? 'plan_coins'
       and (
         (new.job_id is not null and r.job_id = new.job_id)
         or r.idempotency_key = regexp_replace(new.idempotency_key, ':(refunded|released)$', '')
       );
    v_take := least(new.amount, v_taken, v_lot.granted + v_lot.rolled_in - v_lot.remaining);
    if v_take > 0 then
      update public.coin_lots set remaining = remaining + v_take where id = v_lot.id;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('plan_coins_restored', v_take, 'lot_id', v_lot.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger credit_transactions_coin_lot
  before insert on public.credit_transactions
  for each row execute function public.coin_lot_track();

/**
 * Burns what is left of the lots whose month has run out unrenewed.
 *
 * For one person when they next touch their wallet, or for everyone when the
 * generator sweeps. A burn never takes more than the balance holds: J Tanga
 * held for a deck in progress are not in the balance and are not burned.
 */
create or replace function public.expire_coin_lots(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.coin_lots%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_burn integer;
  v_count integer := 0;
begin
  for v_lot in
    select * from public.coin_lots
     where status = 'active' and expires_at <= now()
       and (p_user_id is null or user_id = p_user_id)
     order by expires_at
     for update skip locked
  loop
    select * into v_wallet from public.credit_wallets where user_id = v_lot.user_id for update;
    v_burn := least(v_lot.remaining, greatest(coalesce(v_wallet.balance, 0), 0));
    if v_burn > 0 then
      insert into public.credit_transactions (
        user_id, type, amount, reservation_delta, balance_after, reserved_after,
        idempotency_key, description, metadata
      ) values (
        v_lot.user_id, 'plan_expiry', -v_burn, 0,
        v_wallet.balance - v_burn, v_wallet.reserved,
        'plan-expiry:' || v_lot.id::text,
        'Tarif J Tangalari muddati tugadi',
        jsonb_build_object('lot_id', v_lot.id, 'plan_code', v_lot.plan_code)
      ) on conflict (user_id, idempotency_key) do nothing;
      if found then
        update public.credit_wallets
           set balance = balance - v_burn, version = version + 1
         where user_id = v_lot.user_id;
      else
        v_burn := 0;
      end if;
    end if;
    update public.coin_lots
       set status = 'expired', remaining = 0, burned = v_burn, closed_at = now()
     where id = v_lot.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.expire_coin_lots(uuid) from public, anon, authenticated;
grant execute on function public.expire_coin_lots(uuid) to service_role;

/* ---------------------------------------------------- presentation pages */

create table public.presentation_credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('welcome', 'purchase', 'admin')),
  pages_granted integer not null check (pages_granted > 0),
  pages_remaining integer not null check (pages_remaining >= 0),
  pages_reserved integer not null default 0 check (pages_reserved >= 0),
  order_id uuid unique references public.orders(id) on delete set null,
  granted_by uuid references auth.users(id) on delete set null,
  note text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presentation_credit_grants_balance check (pages_remaining + pages_reserved <= pages_granted)
);

-- One welcome per account, enforced by the database rather than by care.
create unique index presentation_credit_grants_one_welcome
  on public.presentation_credit_grants(user_id) where source = 'welcome';
create index presentation_credit_grants_user on public.presentation_credit_grants(user_id, created_at);

create table public.presentation_credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid not null references public.presentation_credit_grants(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  kind text not null check (kind in ('grant', 'reserve', 'capture', 'release', 'expire', 'adjust')),
  pages integer not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index presentation_credit_ledger_job on public.presentation_credit_ledger(job_id);

/**
 * One welcome per real identity.
 *
 * Keyed by a hash of the account's email (or phone), not by the account, so
 * deleting an account and signing up again with the same address is not a
 * second welcome. Rows outlive the accounts they name, on purpose.
 */
create table public.welcome_claims (
  identity_hash text primary key,
  user_id uuid,
  created_at timestamptz not null default now()
);

alter table public.presentation_credit_grants enable row level security;
alter table public.presentation_credit_ledger enable row level security;
alter table public.welcome_claims enable row level security;

create policy presentation_credit_grants_own on public.presentation_credit_grants for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy presentation_credit_ledger_own on public.presentation_credit_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));
-- welcome_claims: no policy — nobody but the definer functions reads it.

/*
 * Grants. The privilege hardening of 202608100012 gives new tables nothing
 * by default, so each says who may read it; RLS then narrows the rows.
 */
grant select on public.economy_versions, public.service_prices to anon, authenticated;
grant select on public.coin_lots, public.presentation_credit_grants, public.presentation_credit_ledger to authenticated;
grant all on public.economy_versions, public.service_prices, public.coin_lots,
  public.presentation_credit_grants, public.presentation_credit_ledger, public.welcome_claims to service_role;
grant usage on sequence public.economy_versions_id_seq, public.service_prices_id_seq,
  public.presentation_credit_ledger_id_seq to service_role;

/* ------------------------------------------------------------- packages */

alter table public.coin_packages
  add column if not exists presentation_pages integer not null default 0,
  add column if not exists purchase_limit integer,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists label_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb;

alter table public.coin_packages drop constraint if exists coin_packages_amounts;
alter table public.coin_packages
  add constraint coin_packages_amounts check (
    coins >= 0 and bonus_coins >= 0 and price_amount >= 0 and presentation_pages >= 0
    -- A pack is J Tanga or presentation pages, never both: the two are spent
    -- under different rules and a buyer must know which they hold.
    and ((coins > 0 and presentation_pages = 0) or (coins = 0 and bonus_coins = 0 and presentation_pages > 0))
  ),
  add constraint coin_packages_purchase_limit check (purchase_limit is null or purchase_limit > 0),
  add constraint coin_packages_window check (starts_at is null or ends_at is null or starts_at < ends_at);

do $$
begin
  -- The earlier packs leave the shop; their orders and history stay.
  update public.coin_packages set is_active = false
   where code not in ('jt_100', 'jt_300', 'jt_500', 'jt_1000', 'pages_10');

  insert into public.coin_packages (
    code, label, description, coins, bonus_coins, price_amount, currency, sort_order, is_active,
    presentation_pages, label_i18n, description_i18n
  ) values
    ('jt_100', '100 J Tanga', 'Har qanday xizmat uchun', 100, 0, 2900, 'UZS', 10, true, 0,
     '{"uz":"100 J Tanga","en":"100 J Tanga","ru":"100 J Tanga"}',
     '{"uz":"Har qanday xizmat uchun","en":"For any service","ru":"Для любых услуг"}'),
    ('jt_300', '300 J Tanga', 'Har qanday xizmat uchun', 300, 0, 8700, 'UZS', 20, true, 0,
     '{"uz":"300 J Tanga","en":"300 J Tanga","ru":"300 J Tanga"}',
     '{"uz":"Har qanday xizmat uchun","en":"For any service","ru":"Для любых услуг"}'),
    ('jt_500', '500 J Tanga', 'Har qanday xizmat uchun', 500, 0, 14500, 'UZS', 30, true, 0,
     '{"uz":"500 J Tanga","en":"500 J Tanga","ru":"500 J Tanga"}',
     '{"uz":"Har qanday xizmat uchun","en":"For any service","ru":"Для любых услуг"}'),
    ('jt_1000', '1000 J Tanga', 'Har qanday xizmat uchun', 1000, 0, 29000, 'UZS', 40, true, 0,
     '{"uz":"1000 J Tanga","en":"1000 J Tanga","ru":"1000 J Tanga"}',
     '{"uz":"Har qanday xizmat uchun","en":"For any service","ru":"Для любых услуг"}'),
    ('pages_10', '10 sahifalik qo‘shimcha taqdimot', 'Faqat taqdimot uchun: aniq 10 sahifa', 0, 0, 2900, 'UZS', 5, true, 10,
     '{"uz":"10 sahifalik qo‘shimcha taqdimot","en":"Extra 10-page presentation","ru":"Дополнительная презентация на 10 страниц"}',
     '{"uz":"Faqat taqdimot uchun: aniq 10 sahifa","en":"Presentations only: exactly 10 pages","ru":"Только для презентаций: ровно 10 страниц"}')
  on conflict (code) do nothing;
end;
$$;

/* ------------------------------------------------------------- pricing */

alter table public.generation_jobs add column if not exists pricing jsonb;

comment on column public.generation_jobs.pricing is
  'The quote this job was started on — pages, how many came from welcome and bought pages, J Tanga, rate and economy version — so settling it never reads a later price. Null for jobs started before page pricing.';

/** What decides one person's price per page right now. */
create or replace function public.presentation_rate(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_econ public.economy_versions%rowtype;
  v_price public.service_prices%rowtype;
  v_sub public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_multiplier numeric;
  v_billing text := 'none';
  v_promo numeric := 0;
begin
  v_econ := public.economy_current();
  v_price := public.service_price('presentation');
  if v_econ.id is null or v_price.id is null then
    raise exception 'presentation pricing is not configured' using errcode = '55000';
  end if;
  v_multiplier := v_econ.no_plan_multiplier;

  if p_user_id is not null then
    select s.* into v_sub from public.user_subscriptions s
     where s.user_id = p_user_id and s.status = 'active' and s.expires_at > now()
     order by s.expires_at desc limit 1;
    if v_sub.id is not null then
      select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
      -- The tariff as it was sold: a later edit of the plan changes nothing
      -- for somebody who already paid for it.
      v_billing := coalesce(v_sub.plan_snapshot ->> 'billing_model', v_plan.billing_model, 'quota');
      if v_billing = 'coins' then
        v_multiplier := coalesce((v_sub.plan_snapshot ->> 'page_multiplier')::numeric, v_plan.page_multiplier, v_multiplier);
      end if;
    end if;
  end if;

  if v_price.promo_percent > 0 and (v_price.promo_until is null or v_price.promo_until > now()) then
    v_promo := v_price.promo_percent;
  end if;

  return jsonb_build_object(
    'billing', v_billing,
    'plan_code', v_plan.code,
    'multiplier', v_multiplier,
    'per_page', v_price.coins_per_unit * v_multiplier * (1 - v_promo / 100),
    'rounding', v_econ.rounding,
    'version', v_econ.version,
    'min_charge', greatest(v_econ.min_charge, v_price.min_charge),
    'max_charge', least(v_econ.max_charge, v_price.max_charge),
    'min_pages', v_price.min_units,
    'max_pages', v_price.max_units,
    'enabled', v_price.is_enabled
  );
end;
$$;

/** J Tanga for a number of pages at a rate, rounded and bounded as the version says. */
create or replace function public.coins_for_pages(p_pages integer, p_rate jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_pages, 0) <= 0 then 0 else
    least(
      greatest(
        public.coins_round(p_pages * (p_rate ->> 'per_page')::numeric, p_rate ->> 'rounding'),
        (p_rate ->> 'min_charge')::integer),
      (p_rate ->> 'max_charge')::integer)
  end;
$$;

/**
 * What a deck of `p_pages` would cost this person, and from what.
 *
 * Welcome pages first, then bought presentation pages, then J Tanga for the
 * rest at the person's rate. A PREMIUM member on the old weekly count is told
 * so (`mode: quota`) and charged nothing here; their count is the price.
 */
create or replace function public.presentation_quote_for(p_user_id uuid, p_pages integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate jsonb;
  v_welcome integer := 0;
  v_bought integer := 0;
  v_take_welcome integer;
  v_take_bought integer;
  v_rest integer;
  v_coins integer := 0;
  v_wallet public.credit_wallets%rowtype;
  v_lot public.coin_lots%rowtype;
begin
  v_rate := public.presentation_rate(p_user_id);
  if p_pages is null or p_pages < (v_rate ->> 'min_pages')::integer or p_pages > (v_rate ->> 'max_pages')::integer then
    raise exception 'Sahifalar soni % dan % gacha bo‘lishi kerak.', v_rate ->> 'min_pages', v_rate ->> 'max_pages'
      using errcode = '22023';
  end if;

  select * into v_wallet from public.credit_wallets where user_id = p_user_id;
  select * into v_lot from public.coin_lots where user_id = p_user_id and status = 'active';

  if v_rate ->> 'billing' = 'quota' then
    return jsonb_build_object(
      'mode', 'quota', 'pages', p_pages, 'coins', 0,
      'welcome_pages', 0, 'purchased_pages', 0, 'paid_pages', 0,
      'balance', coalesce(v_wallet.balance, 0),
      'quota', public.quota_status('presentation_weekly', p_user_id),
      'plan_code', v_rate -> 'plan_code', 'sufficient', true, 'requires_confirmation', false);
  end if;

  select coalesce(sum(pages_remaining) filter (where source = 'welcome'), 0),
         coalesce(sum(pages_remaining) filter (where source <> 'welcome'), 0)
    into v_welcome, v_bought
    from public.presentation_credit_grants
   where user_id = p_user_id and (expires_at is null or expires_at > now());

  v_take_welcome := least(v_welcome, p_pages);
  v_rest := p_pages - v_take_welcome;
  v_take_bought := least(v_bought, v_rest);
  v_rest := v_rest - v_take_bought;
  v_coins := public.coins_for_pages(v_rest, v_rate);

  return jsonb_build_object(
    'mode', 'credits',
    'pages', p_pages,
    'welcome_pages', v_take_welcome,
    'purchased_pages', v_take_bought,
    'paid_pages', v_rest,
    'coins', v_coins,
    'balance', coalesce(v_wallet.balance, 0),
    'plan_coins', case when v_lot.expires_at > now() then v_lot.remaining else 0 end,
    'plan_expires_at', v_lot.expires_at,
    'welcome_remaining', v_welcome,
    'purchased_remaining', v_bought,
    'per_page', round((v_rate ->> 'per_page')::numeric, 6),
    'multiplier', v_rate -> 'multiplier',
    'plan_code', v_rate -> 'plan_code',
    'version', v_rate -> 'version',
    'sufficient', coalesce(v_wallet.balance, 0) >= v_coins,
    'requires_confirmation', v_coins > 0
  );
end;
$$;

/** The quote, for the signed-in person. Burns an expired tariff month first so the balance it reads is true. */
create or replace function public.presentation_quote(p_slide_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.expire_coin_lots(v_user);
  return public.presentation_quote_for(v_user, p_slide_count);
end;
$$;

revoke all on function public.presentation_quote(integer) from public, anon;
grant execute on function public.presentation_quote(integer) to authenticated;
revoke all on function public.presentation_quote_for(uuid, integer) from public, anon, authenticated;
revoke all on function public.presentation_rate(uuid) from public, anon, authenticated;

/**
 * What older builds of the app ask before generating: the J Tanga a deck
 * will take, now that pages come first. Same name and arguments as before;
 * `p_style` no longer changes the price.
 */
create or replace function public.estimate_presentation_credits(
  p_style public.presentation_style,
  p_slide_count integer
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((public.presentation_quote_for(auth.uid(), p_slide_count) ->> 'coins')::integer, 0);
end;
$$;

/* ------------------------------------------------- welcome and pages */

/**
 * The welcome: presentation pages, once per real identity.
 *
 * Called when an account is created. Only accounts created on or after the
 * version's `eligible_from` qualify, unless the operator turned on
 * `retroactive` or forces it from the admin panel. The identity is the
 * account's email or phone, hashed; the same address signing up again after
 * deleting its account gets nothing.
 */
create or replace function public.grant_welcome_pages(p_user_id uuid, p_identity text, p_force boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_welcome jsonb := coalesce((public.economy_current()).welcome, '{}'::jsonb);
  v_pages integer := coalesce((v_welcome ->> 'pages')::integer, 0);
  v_created timestamptz;
  v_hash text;
  v_grant uuid;
begin
  if not coalesce((v_welcome ->> 'enabled')::boolean, false) or v_pages <= 0 then
    return false;
  end if;
  select created_at into v_created from auth.users where id = p_user_id;
  if v_created is null then return false; end if;
  if not p_force
     and not coalesce((v_welcome ->> 'retroactive')::boolean, false)
     and v_created < coalesce((v_welcome ->> 'eligible_from')::timestamptz, '-infinity'::timestamptz) then
    return false;
  end if;
  if exists (select 1 from public.presentation_credit_grants where user_id = p_user_id and source = 'welcome') then
    return false;
  end if;

  if nullif(btrim(coalesce(p_identity, '')), '') is not null then
    v_hash := encode(extensions.digest(lower(btrim(p_identity)), 'sha256'), 'hex');
    insert into public.welcome_claims (identity_hash, user_id) values (v_hash, p_user_id)
      on conflict (identity_hash) do nothing;
    if not found then return false; end if;
  end if;

  insert into public.presentation_credit_grants (user_id, source, pages_granted, pages_remaining, expires_at, note)
  values (
    p_user_id, 'welcome', v_pages, v_pages,
    case when v_welcome ->> 'expires_days' is not null
         then now() + make_interval(days => (v_welcome ->> 'expires_days')::integer) end,
    'Xush kelibsiz: 3 ta bepul taqdimot'
  )
  on conflict do nothing
  returning id into v_grant;
  if v_grant is null then return false; end if;

  insert into public.presentation_credit_ledger (user_id, grant_id, kind, pages, idempotency_key, metadata)
  values (p_user_id, v_grant, 'grant', v_pages, 'welcome:' || p_user_id::text,
          jsonb_build_object('version', (public.economy_current()).version));
  return true;
end;
$$;

revoke all on function public.grant_welcome_pages(uuid, text, boolean) from public, anon, authenticated;

/** A new account: the profile, the role, the wallet and its J Tanga as before — and the welcome pages. */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial_credits integer;
begin
  select coalesce((value #>> '{}')::integer, 100)
    into v_initial_credits
    from public.app_settings
    where key = 'credits.initial_grant';
  v_initial_credits := coalesce(v_initial_credits, 100);

  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    new.raw_user_meta_data ->> 'avatar_url'
  ) on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user') on conflict do nothing;

  insert into public.credit_wallets (user_id, balance, lifetime_granted)
  values (new.id, v_initial_credits, v_initial_credits) on conflict (user_id) do nothing;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description
  ) values (
    new.id, 'grant', v_initial_credits, v_initial_credits, 0,
    'initial-grant:' || new.id::text, 'Welcome credits'
  ) on conflict (user_id, idempotency_key) do nothing;

  -- The welcome pages never stand between a person and their account: if
  -- granting them fails, the account is still created and the failure logged.
  begin
    perform public.grant_welcome_pages(new.id, coalesce(nullif(new.email, ''), nullif(new.phone, '')), false);
  exception when others then
    raise warning 'welcome pages not granted to %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

/**
 * Holds pages for a job: welcome pages first, then bought ones, the soonest to
 * expire first. Returns how many came from each. The caller has already
 * quoted and checked that there are enough.
 */
create or replace function public.presentation_pages_reserve(p_user_id uuid, p_job_id uuid, p_pages integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.presentation_credit_grants%rowtype;
  v_left integer := greatest(coalesce(p_pages, 0), 0);
  v_take integer;
  v_welcome integer := 0;
  v_bought integer := 0;
begin
  for v_grant in
    select * from public.presentation_credit_grants
     where user_id = p_user_id and pages_remaining > 0
       and (expires_at is null or expires_at > now())
     order by (source = 'welcome') desc, expires_at nulls last, created_at
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_grant.pages_remaining, v_left);
    update public.presentation_credit_grants
       set pages_remaining = pages_remaining - v_take,
           pages_reserved = pages_reserved + v_take,
           updated_at = now()
     where id = v_grant.id;
    insert into public.presentation_credit_ledger (user_id, grant_id, job_id, kind, pages, idempotency_key)
    values (p_user_id, v_grant.id, p_job_id, 'reserve', -v_take, 'reserve:' || p_job_id::text || ':' || v_grant.id::text);
    if v_grant.source = 'welcome' then v_welcome := v_welcome + v_take; else v_bought := v_bought + v_take; end if;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'presentation pages ran out while reserving' using errcode = 'P0001';
  end if;
  return jsonb_build_object('welcome', v_welcome, 'purchased', v_bought);
end;
$$;

/** Ends a job's page reservation: spent (`p_capture`) or given back. Idempotent. */
create or replace function public.presentation_pages_finish(p_job_id uuid, p_capture boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_kind text := case when p_capture then 'capture' else 'release' end;
  v_count integer := 0;
begin
  for v_row in
    select l.user_id, l.grant_id, -l.pages as pages
      from public.presentation_credit_ledger l
     where l.job_id = p_job_id and l.kind = 'reserve'
       and not exists (
         select 1 from public.presentation_credit_ledger f
          where f.user_id = l.user_id
            and f.idempotency_key in ('capture:' || p_job_id::text || ':' || l.grant_id::text,
                                      'release:' || p_job_id::text || ':' || l.grant_id::text))
  loop
    insert into public.presentation_credit_ledger (user_id, grant_id, job_id, kind, pages, idempotency_key)
    values (v_row.user_id, v_row.grant_id, p_job_id, v_kind,
            case when p_capture then 0 else v_row.pages end,
            v_kind || ':' || p_job_id::text || ':' || v_row.grant_id::text)
    on conflict (user_id, idempotency_key) do nothing;
    if found then
      update public.presentation_credit_grants
         set pages_reserved = greatest(pages_reserved - v_row.pages, 0),
             pages_remaining = pages_remaining + case when p_capture then 0 else v_row.pages end,
             updated_at = now()
       where id = v_row.grant_id;
      v_count := v_count + v_row.pages;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.presentation_pages_reserve(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.presentation_pages_finish(uuid, boolean) from public, anon, authenticated;

/* ---------------------------------------------------------- generation */

drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text);
drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text);
drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text);

/**
 * Starts a deck, priced by its pages.
 *
 * A PREMIUM member on the old weekly count spends one of their week, as
 * before. Everyone else pays from their welcome pages, then their bought
 * pages, then J Tanga at their tariff's rate — all reserved here, with the job,
 * in one transaction, and the quote stored on the job so settling it never
 * reads a later price.
 *
 * `p_confirmed_coins` is the J Tanga the person agreed to on screen. When the
 * price has risen past it since they looked, nothing is spent and they are
 * asked again. An older build that does not send it was shown the price by
 * `estimate_presentation_credits`, which this replaces with the same number.
 */
create or replace function public.start_generation(
  p_presentation_id uuid, p_topic text, p_title text, p_style public.presentation_style, p_slide_count integer,
  p_author_name text default null, p_teacher_name text default null, p_sources text[] default '{}'::text[],
  p_idempotency_key text default null, p_template_code text default null, p_palette_code text default null,
  p_design_slug text default null, p_confirmed_coins integer default null
)
returns table(presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entitlements jsonb;
  v_quota_member boolean := false;
  v_plan_slides integer;
  v_quota jsonb;
  v_quote jsonb;
  v_period text;
  v_job_id uuid;
  v_coins integer := 0;
  v_wallet public.credit_wallets%rowtype;
  v_idempotency text := coalesce(nullif(btrim(p_idempotency_key), ''), p_presentation_id::text);
  v_existing public.generation_jobs%rowtype;
  v_pages jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_presentation_id is null or char_length(btrim(p_topic)) < 3 then
    raise exception 'valid presentation id and topic are required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_user_id and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  select * into v_existing
  from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_idempotency;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  perform public.expire_coin_lots(v_user_id);
  v_entitlements := public.my_entitlements(v_user_id);
  v_quota_member := coalesce((v_entitlements ->> 'member')::boolean, false)
    and coalesce(v_entitlements -> 'plan' ->> 'billing', 'quota') = 'quota';

  if v_quota_member then
    v_plan_slides := coalesce((v_entitlements -> 'features' -> 'presentation_max_slides' ->> 'limit')::integer, 0);
    if v_plan_slides > 0 and p_slide_count > v_plan_slides then
      raise exception 'Tarifingizda bitta prezentatsiya uchun eng ko''pi % ta slayd.', v_plan_slides
        using errcode = '22023';
    end if;

    v_quota := public.quota_consume('presentation_weekly', 1, v_user_id);
    if coalesce((v_quota ->> 'ok')::boolean, false) is not true then
      v_period := coalesce(v_entitlements -> 'features' -> 'presentation_weekly' ->> 'period', 'week');
      raise exception '% prezentatsiya limiti tugadi (% / %). Yangilanadi: %',
        case v_period when 'day' then 'Kunlik' when 'month' then 'Oylik' else 'Haftalik' end,
        v_quota ->> 'used', v_quota ->> 'limit', v_quota ->> 'resets_at'
        using errcode = 'P0001', detail = 'quota_exhausted';
    end if;

    if (v_quota ->> 'remaining')::integer = 0
      and not exists (
        select 1 from public.notifications
        where user_id = v_user_id
          and payload ->> 'event' = 'presentation_quota_exhausted'
          and payload ->> 'resets_at' is not distinct from v_quota ->> 'resets_at'
      )
    then
      v_period := coalesce(v_entitlements -> 'features' -> 'presentation_weekly' ->> 'period', 'week');
      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_user_id, 'system',
        format('%s ta taqdimotning hammasi yaratildi', v_quota ->> 'limit'),
        format('%s limitingiz tugadi. Tarifni qayta boshlab, yangi %s ta taqdimot yaratishingiz mumkin.',
          case v_period when 'day' then 'Kunlik' when 'month' then 'Oylik' else 'Haftalik' end,
          v_quota ->> 'limit'),
        jsonb_build_object('event', 'presentation_quota_exhausted', 'limit', v_quota -> 'limit', 'resets_at', v_quota -> 'resets_at'),
        '/(app)/tarif'
      );
    end if;
    v_quote := jsonb_build_object('mode', 'quota', 'pages', p_slide_count, 'coins', 0);
  else
    v_quote := public.presentation_quote_for(v_user_id, p_slide_count);
    v_coins := (v_quote ->> 'coins')::integer;
    if v_coins > 0 then
      if p_confirmed_coins is not null and p_confirmed_coins < v_coins then
        raise exception 'Narx yangilandi: bu taqdimot % J Tanga turadi. Iltimos, qayta tasdiqlang.', v_coins
          using errcode = 'P0001', detail = 'confirmation_required';
      end if;
      select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
      if not found then
        raise exception 'credit wallet not found' using errcode = 'P0002';
      end if;
      if v_wallet.balance < v_coins then
        raise exception 'insufficient credits' using errcode = 'P0001',
          detail = format('required=%s available=%s', v_coins, v_wallet.balance);
      end if;
    end if;
  end if;

  insert into public.presentations (
    id, owner_id, title, topic, style, status, requested_slide_count,
    author_name, teacher_name, estimated_credits, reserved_credits,
    template_code, palette_code, design_id, design_version, design_engine
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_coins, v_coins,
    null, null, null, null, 'glass_v1'
  );

  insert into public.presentation_sources (presentation_id, owner_id, label, position)
  select p_presentation_id, v_user_id, left(btrim(source), 1000), ordinality::integer - 1
  from unnest(p_sources) with ordinality as source_rows(source, ordinality)
  where nullif(btrim(source), '') is not null;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress, reserved_credits, pricing
  ) values (
    p_presentation_id, v_user_id, v_idempotency, 'queued', 'preparing', 0, v_coins, v_quote
  ) returning id into v_job_id;

  insert into public.generation_steps (
    job_id, presentation_id, owner_id, sequence, key, label, status, progress
  ) values (
    v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda', 'queued', 0
  );

  if not v_quota_member then
    if coalesce((v_quote ->> 'welcome_pages')::integer, 0) + coalesce((v_quote ->> 'purchased_pages')::integer, 0) > 0 then
      v_pages := public.presentation_pages_reserve(v_user_id, v_job_id,
        (v_quote ->> 'welcome_pages')::integer + (v_quote ->> 'purchased_pages')::integer);
    end if;

    if v_coins > 0 then
      insert into public.credit_transactions (
        user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
        idempotency_key, description, metadata
      ) values (
        v_user_id, v_job_id, 'reservation', -v_coins, v_coins,
        v_wallet.balance - v_coins, v_wallet.reserved + v_coins,
        'reserve:' || v_idempotency, 'Taqdimot uchun J Tanga band qilindi',
        jsonb_build_object(
          'presentation_id', p_presentation_id, 'slide_count', p_slide_count, 'engine', 'glass_v1',
          'pages', v_quote -> 'paid_pages', 'per_page', v_quote -> 'per_page', 'version', v_quote -> 'version')
      );
      update public.credit_wallets
        set balance = balance - v_coins, reserved = reserved + v_coins, version = version + 1
        where user_id = v_user_id;
    end if;
  end if;

  return query select p_presentation_id, v_job_id, v_coins;
end;
$$;

revoke all on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text, integer) from public, anon;
grant execute on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text, integer) to authenticated;

/**
 * A failed deck tried again, priced the way a new one is. The person already
 * agreed to this deck's price; a retry takes what the deck costs now and says
 * so on the generation screen.
 */
create or replace function public.retry_generation(p_presentation_id uuid, p_idempotency_key text)
returns table (presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_presentation public.presentations%rowtype;
  v_existing public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_entitlements jsonb;
  v_quota_member boolean;
  v_quota jsonb;
  v_quote jsonb;
  v_job_id uuid;
  v_coins integer := 0;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if v_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;

  select * into v_existing from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_key;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  select * into v_presentation from public.presentations
  where id = p_presentation_id and owner_id = v_user_id for update;
  if not found then raise exception 'presentation not found' using errcode = 'P0002'; end if;
  if v_presentation.status <> 'failed' then raise exception 'only failed presentations can be retried' using errcode = '55000'; end if;
  if exists (select 1 from public.profiles where id = v_user_id and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  perform public.expire_coin_lots(v_user_id);
  v_entitlements := public.my_entitlements(v_user_id);
  v_quota_member := coalesce((v_entitlements ->> 'member')::boolean, false)
    and coalesce(v_entitlements -> 'plan' ->> 'billing', 'quota') = 'quota';

  if v_quota_member then
    v_quota := public.quota_consume('presentation_weekly', 1, v_user_id);
    if coalesce((v_quota ->> 'ok')::boolean, false) is not true then
      raise exception 'Prezentatsiya limiti tugadi (% / %).', v_quota ->> 'used', v_quota ->> 'limit'
        using errcode = 'P0001', detail = 'quota_exhausted';
    end if;
    v_quote := jsonb_build_object('mode', 'quota', 'pages', v_presentation.requested_slide_count, 'coins', 0);
  else
    v_quote := public.presentation_quote_for(v_user_id, v_presentation.requested_slide_count);
    v_coins := (v_quote ->> 'coins')::integer;
    if v_coins > 0 then
      select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
      if v_wallet.balance < v_coins then raise exception 'insufficient credits' using errcode = 'P0001'; end if;
    end if;
  end if;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress,
    reserved_credits, attempt_count, context, pricing
  ) values (
    p_presentation_id, v_user_id, v_key, 'queued', 'preparing', 0,
    v_coins,
    (select count(*)::integer from public.generation_jobs as previous_job where previous_job.presentation_id = p_presentation_id),
    jsonb_build_object('retry', true),
    v_quote
  ) returning id into v_job_id;

  insert into public.generation_steps (job_id, presentation_id, owner_id, sequence, key, label)
  values (v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda');

  if not v_quota_member then
    if coalesce((v_quote ->> 'welcome_pages')::integer, 0) + coalesce((v_quote ->> 'purchased_pages')::integer, 0) > 0 then
      perform public.presentation_pages_reserve(v_user_id, v_job_id,
        (v_quote ->> 'welcome_pages')::integer + (v_quote ->> 'purchased_pages')::integer);
    end if;
    if v_coins > 0 then
      insert into public.credit_transactions (
        user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
        idempotency_key, description, metadata
      ) values (
        v_user_id, v_job_id, 'reservation', -v_coins, v_coins,
        v_wallet.balance - v_coins, v_wallet.reserved + v_coins,
        'reserve:' || v_key, 'Taqdimotni qayta yaratish uchun J Tanga band qilindi',
        jsonb_build_object('presentation_id', p_presentation_id, 'retry', true,
          'pages', v_quote -> 'paid_pages', 'per_page', v_quote -> 'per_page', 'version', v_quote -> 'version')
      );
      update public.credit_wallets set
        balance = balance - v_coins, reserved = reserved + v_coins, version = version + 1
      where user_id = v_user_id;
    end if;
  end if;

  update public.presentations set
    status = 'queued', estimated_credits = v_coins, reserved_credits = v_coins,
    actual_credits = 0, error_message = null
  where id = p_presentation_id;

  return query select p_presentation_id, v_job_id, v_coins;
end;
$$;

grant execute on function public.retry_generation(uuid, text) to authenticated;

/** A deck that failed gives everything back: its J Tanga, its pages, or the member's week. */
create or replace function public.fail_generation(p_job_id uuid, p_error_code text, p_error_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'generation job not found' using errcode = 'P0002'; end if;
  if v_job.status in ('failed', 'cancelled', 'succeeded') then return; end if;

  if v_job.reserved_credits > 0 then
    select * into v_wallet from public.credit_wallets where user_id = v_job.owner_id for update;
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'refund', v_job.reserved_credits, -v_job.reserved_credits,
      v_wallet.balance + v_job.reserved_credits, v_wallet.reserved - v_job.reserved_credits,
      'failure-refund:' || v_job.id::text, 'Generation failure refund',
      jsonb_build_object('error_code', left(coalesce(p_error_code, 'generation_failed'), 120))
    ) on conflict (user_id, idempotency_key) do nothing;
    if found then
      update public.credit_wallets
        set balance = balance + v_job.reserved_credits,
            reserved = greatest(reserved - v_job.reserved_credits, 0),
            version = version + 1
        where user_id = v_job.owner_id;
    end if;
  end if;

  perform public.presentation_pages_finish(v_job.id, false);

  -- A member's week paid for this one: a crash of ours must not cost them it.
  if v_job.reserved_credits = 0 and coalesce(v_job.pricing ->> 'mode', 'quota') = 'quota' then
    perform public.quota_release('presentation_weekly', 1, v_job.owner_id);
  end if;

  update public.generation_jobs
    set status = 'failed', stage = 'failed', reserved_credits = 0,
        error_code = left(coalesce(p_error_code, 'generation_failed'), 120),
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000),
        completed_at = now(), heartbeat_at = now()
    where id = v_job.id;
  update public.presentations
    set status = 'failed', reserved_credits = 0,
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000)
    where id = v_job.presentation_id;
end;
$$;

/**
 * A finished deck keeps what was reserved for it. A deck started on a page
 * price is charged exactly its quote — what the generator reports is only
 * recorded — and its pages are spent; an older job settles as it did.
 */
create or replace function public.settle_generation(p_job_id uuid, p_actual_credits integer, p_provider_cost_usd numeric default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_charge integer;
  v_release integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actual_credits < 0 or p_provider_cost_usd < 0 then
    raise exception 'usage values must be nonnegative' using errcode = '22023';
  end if;

  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'generation job not found' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' then return; end if;
  if v_job.status in ('failed', 'cancelled') then
    raise exception 'generation job is already closed' using errcode = '55000';
  end if;

  select * into v_wallet from public.credit_wallets where user_id = v_job.owner_id for update;
  v_charge := case when v_job.pricing is not null then v_job.reserved_credits
                   else least(p_actual_credits, v_job.reserved_credits) end;
  v_release := v_job.reserved_credits - v_charge;

  update public.credit_wallets
    set balance = balance + v_release,
        reserved = greatest(reserved - v_job.reserved_credits, 0),
        lifetime_spent = lifetime_spent + v_charge,
        version = version + 1
    where user_id = v_job.owner_id;

  if v_charge > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'charge', 0, -v_charge,
      v_wallet.balance, v_wallet.reserved - v_charge,
      'settle-charge:' || v_job.id::text, 'Generation credits charged',
      jsonb_build_object('actual_credits', v_charge, 'reported_credits', p_actual_credits, 'pricing', v_job.pricing)
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  if v_release > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'release', v_release, -v_release,
      v_wallet.balance + v_release, v_wallet.reserved - v_job.reserved_credits,
      'settle-release:' || v_job.id::text, 'Unused reserved credits released',
      jsonb_build_object('reserved_credits', v_job.reserved_credits, 'actual_credits', v_charge)
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  perform public.presentation_pages_finish(v_job.id, true);

  update public.generation_jobs
    set status = 'succeeded', stage = 'ready', progress = 100,
        actual_credits = v_charge, completed_at = now(), heartbeat_at = now()
    where id = v_job.id;
  update public.presentations
    set status = 'ready', actual_credits = v_charge, reserved_credits = 0,
        generation_cost_usd = p_provider_cost_usd, error_message = null
    where id = v_job.presentation_id;
end;
$$;

/* ----------------------------------------------------- entitlements */

/** As before, and the plan now says how it bills: `quota` (PREMIUM's weekly count) or `coins`. */
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
  perform public.assert_reads_own_entitlements(p_user_id);

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
  v_features := coalesce(nullif(v_sub.plan_snapshot -> 'features', 'null'::jsonb), v_plan.features);

  return jsonb_build_object(
    'member', true,
    'status', v_sub.status,
    'expires_at', v_sub.expires_at,
    'plan', jsonb_build_object(
      'code', v_plan.code, 'name', v_plan.name, 'price_amount', v_plan.price_amount,
      'currency', v_plan.currency, 'period_days', v_plan.period_days,
      'billing', coalesce(v_sub.plan_snapshot ->> 'billing_model', v_plan.billing_model, 'quota'),
      'name_i18n', v_plan.name_i18n),
    'features', v_features
  );
end;
$$;

/** As before, and an expired tariff month burns before anything is reserved from it. */
create or replace function public.jcoin_reserve(
  p_operation text,
  p_idempotency_key text,
  p_reference_id uuid default null,
  p_user_id uuid default auth.uid(),
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost integer;
  v_wallet public.credit_wallets%rowtype;
  v_existing public.credit_transactions%rowtype;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into v_existing from public.credit_transactions
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'repeated', true, 'operation', p_operation,
      'amount', abs(v_existing.amount), 'idempotency_key', p_idempotency_key);
  end if;

  select coalesce((value -> p_operation ->> 'base_credits')::integer, -1)
    into v_cost
    from public.app_settings where key = 'credits.operation_costs';
  if v_cost is null or v_cost < 0 then
    raise exception 'unknown priced operation: %', p_operation using errcode = '22023';
  end if;

  if v_cost = 0 then
    return jsonb_build_object('ok', true, 'repeated', false, 'operation', p_operation,
      'amount', 0, 'idempotency_key', p_idempotency_key);
  end if;

  perform public.expire_coin_lots(p_user_id);
  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;
  if not found then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;
  if v_wallet.balance < v_cost then
    return jsonb_build_object('ok', false, 'code', 'insufficient_jcoin',
      'operation', p_operation, 'amount', v_cost, 'balance', v_wallet.balance);
  end if;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_user_id, 'reservation', -v_cost, v_cost,
    v_wallet.balance - v_cost, v_wallet.reserved + v_cost,
    p_idempotency_key, 'J Tanga band qilindi: ' || p_operation,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('operation', p_operation, 'reference_id', p_reference_id)
  );

  update public.credit_wallets
     set balance = balance - v_cost, reserved = reserved + v_cost, version = version + 1
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'repeated', false, 'operation', p_operation,
    'amount', v_cost, 'idempotency_key', p_idempotency_key,
    'balance', v_wallet.balance - v_cost);
end;
$$;


/* ----------------------------------------------------- tariff months */

/**
 * A tariff month's J Tanga: a new lot, carrying in what was left of the
 * current one (a renewal, or a change of tariff) and anything converted from
 * PREMIUM's count. Burns an already-expired lot first — a month that ran out
 * before the renewal arrived is gone, as the tariff says.
 */
create or replace function public.plan_lot_grant(
  p_user_id uuid, p_subscription_id uuid, p_order public.orders, p_plan_code text,
  p_coins integer, p_converted integer, p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.coin_lots%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_roll integer := 0;
  v_added integer := greatest(coalesce(p_coins, 0), 0) + greatest(coalesce(p_converted, 0), 0);
  v_lot uuid;
begin
  perform public.expire_coin_lots(p_user_id);

  select * into v_old from public.coin_lots where user_id = p_user_id and status = 'active' for update;
  if found then
    v_roll := v_old.remaining;
    update public.coin_lots set status = 'rolled', remaining = 0, closed_at = now() where id = v_old.id;
  end if;

  insert into public.coin_lots (user_id, subscription_id, order_id, plan_code, granted, rolled_in, remaining, expires_at)
  values (p_user_id, p_subscription_id, p_order.id, p_plan_code, greatest(coalesce(p_coins, 0), 0),
          v_roll + greatest(coalesce(p_converted, 0), 0), v_roll + v_added, p_expires_at)
  returning id into v_lot;

  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;
  if v_added > 0 then
    insert into public.credit_transactions (
      user_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      p_user_id, 'plan_grant', v_added, 0, v_wallet.balance + v_added, v_wallet.reserved,
      'plan:' || p_order.order_number,
      'Tarif J Tangalari: ' || upper(p_plan_code),
      jsonb_build_object('order_id', p_order.id, 'lot_id', v_lot, 'plan_code', p_plan_code,
                         'granted', p_coins, 'converted', p_converted, 'rolled_in', v_roll,
                         'expires_at', p_expires_at)
    );
    update public.credit_wallets set
      balance = balance + v_added, lifetime_granted = lifetime_granted + v_added, version = version + 1
      where user_id = p_user_id;
  end if;

  return jsonb_build_object('lot_id', v_lot, 'coins', p_coins, 'converted', p_converted, 'rolled_in', v_roll,
                            'plan_coins', v_roll + v_added, 'expires_at', p_expires_at);
end;
$$;

revoke all on function public.plan_lot_grant(uuid, uuid, public.orders, text, integer, integer, timestamptz) from public, anon, authenticated;

/* ---------------------------------------------------------------- orders */

/** A pack of J Tanga or of presentation pages, within its sale window and per-person limit. */
create or replace function public.order_create_jcoin(p_package_id uuid, p_platform text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_package public.coin_packages%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_price integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_payment_allowed(p_platform, 'jcoin');
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  select * into v_package from public.coin_packages where id = p_package_id and is_active;
  if not found then
    raise exception 'Bu paket sotuvda emas.' using errcode = 'P0002';
  end if;
  if (v_package.starts_at is not null and v_package.starts_at > now())
     or (v_package.ends_at is not null and v_package.ends_at <= now()) then
    raise exception 'Bu paket hozir sotuvda emas.' using errcode = 'P0002';
  end if;
  if v_package.purchase_limit is not null and (
    select count(*) from public.orders
     where user_id = v_user and coin_package_id = v_package.id and status = 'paid'
  ) >= v_package.purchase_limit then
    raise exception 'Bu paketni ko‘pi bilan % marta sotib olish mumkin.', v_package.purchase_limit
      using errcode = 'P0001', detail = 'purchase_limit';
  end if;

  v_existing := public.order_find_open(v_user, 'jcoin', null, p_package_id, null);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  v_price := round(v_package.price_amount)::integer;

  insert into public.orders (
    user_id, purpose, coin_package_id, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    v_user, 'jcoin', p_package_id, v_package.currency,
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('coins', v_package.coins, 'bonus_coins', v_package.bonus_coins,
                       'presentation_pages', v_package.presentation_pages,
                       'package_code', v_package.code, 'label', v_package.label,
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;
  perform public.order_mark_test(v_order.id);
  select * into v_order from public.orders where id = v_order.id;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

/**
 * A paid order, fulfilled once.
 *
 * Redefined whole. Two corrections beyond the new products: the subscription
 * branch writes the membership again (`user_subscriptions`) — 202609010900
 * had rebuilt this function from a version older than 202608230010 and lost
 * it — and a coin tariff's month of J Tanga is granted with the membership.
 */
create or replace function public.order_fulfil(
  p_order_id uuid,
  p_payme_receipt_id text default null,
  p_payme_transaction_id text default null,
  p_provider_cost integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_advanced boolean;
  v_wallet public.credit_wallets%rowtype;
  v_coins integer;
  v_pages integer;
  v_months integer;
  v_entitlement public.module_entitlements%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_previous_plan public.subscription_plans%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_transaction public.payment_transactions%rowtype;
  v_snapshot jsonb;
  v_previous_billing text;
  v_converted integer := 0;
  v_quota jsonb;
  v_rate jsonb;
  v_lot jsonb;
  v_grant uuid;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if v_order.status = 'paid'::public.order_status then
    return jsonb_build_object('order_number', v_order.order_number, 'already', true);
  end if;

  update public.orders set
    payme_receipt_id = coalesce(p_payme_receipt_id, payme_receipt_id),
    payme_transaction_id = coalesce(p_payme_transaction_id, payme_transaction_id)
    where id = p_order_id;

  if v_order.status in ('pending'::public.order_status, 'awaiting_verification'::public.order_status) then
    perform public.order_advance(p_order_id, 'processing'::public.order_status);
  end if;

  v_advanced := public.order_advance(p_order_id, 'paid'::public.order_status);
  if not v_advanced then
    return jsonb_build_object('order_number', v_order.order_number, 'already', true);
  end if;
  select * into v_order from public.orders where id = p_order_id;

  case v_order.purpose
    -- -------------------------------------------- J Tanga or presentation pages --
    when 'jcoin' then
      v_pages := coalesce((v_order.metadata ->> 'presentation_pages')::integer, 0);
      if v_pages > 0 then
        -- Presentation pages are their own balance, spent only on decks; the
        -- order is the grant's key, so a second callback grants nothing.
        insert into public.presentation_credit_grants (user_id, source, pages_granted, pages_remaining, order_id, note)
        values (v_order.user_id, 'purchase', v_pages, v_pages, v_order.id,
                coalesce(v_order.metadata ->> 'label', v_pages || ' sahifa'))
        on conflict (order_id) do nothing
        returning id into v_grant;
        if v_grant is not null then
          insert into public.presentation_credit_ledger (user_id, grant_id, kind, pages, idempotency_key, metadata)
          values (v_order.user_id, v_grant, 'grant', v_pages, 'order:' || v_order.order_number,
                  jsonb_build_object('order_id', v_order.id, 'amount_paid', v_order.total_amount));
        end if;
        insert into public.notifications (user_id, kind, title, body, payload, deep_link)
        values (
          v_order.user_id, 'order_paid', v_pages || ' sahifa taqdimot uchun qo‘shildi',
          'To‘lov muvaffaqiyatli amalga oshirildi. Buyurtma: ' || v_order.order_number,
          jsonb_build_object('order_number', v_order.order_number, 'presentation_pages', v_pages),
          '/(app)/create'
        );
        v_result := jsonb_build_object('presentation_pages_granted', v_pages);
      else
        v_coins := coalesce((v_order.metadata ->> 'coins')::integer, 0)
                 + coalesce((v_order.metadata ->> 'bonus_coins')::integer, 0);
        if v_coins <= 0 then
          raise exception 'order % has no coins to grant', v_order.order_number using errcode = 'P0001';
        end if;

        select * into v_wallet from public.credit_wallets where user_id = v_order.user_id for update;
        if not found then
          raise exception 'credit wallet not found' using errcode = 'P0002';
        end if;

        insert into public.credit_transactions (
          user_id, type, amount, reservation_delta, balance_after, reserved_after,
          idempotency_key, description, metadata
        ) values (
          v_order.user_id, 'coin_purchase', v_coins, 0,
          v_wallet.balance + v_coins, v_wallet.reserved,
          'order:' || v_order.order_number, 'J Tanga xaridi',
          jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                             'amount_paid', v_order.total_amount,
                             'coin_value_uzs', (public.economy_current()).coin_value_uzs)
        );

        update public.credit_wallets set
          balance = balance + v_coins,
          lifetime_granted = lifetime_granted + v_coins,
          version = version + 1
          where user_id = v_order.user_id;

        insert into public.notifications (user_id, kind, title, body, payload, deep_link)
        values (
          v_order.user_id, 'order_paid', v_coins || ' J hisobingizga qo‘shildi',
          'To‘lov muvaffaqiyatli amalga oshirildi. Buyurtma: ' || v_order.order_number,
          jsonb_build_object('order_number', v_order.order_number, 'coins', v_coins),
          '/(app)/(tabs)/profile'
        );
        v_result := jsonb_build_object('coins_granted', v_coins);
      end if;

    -- --------------------------------------------------- module access --
    when 'data_collection' then
      v_months := coalesce((v_order.metadata ->> 'duration_months')::integer, 11);

      select * into v_entitlement from public.module_entitlements
        where user_id = v_order.user_id and module_code = v_order.reference_code
          and status = 'active'::public.entitlement_status
        for update;

      if found then
        update public.module_entitlements set
          expires_at = greatest(v_entitlement.expires_at, now()) + make_interval(months => v_months),
          purchased_amount = v_entitlement.purchased_amount + v_order.total_amount,
          payment_reference = v_order.order_number
          where id = v_entitlement.id;
      else
        insert into public.module_entitlements (
          user_id, module_code, status, starts_at, expires_at,
          purchased_amount, currency, source, payment_reference, metadata
        ) values (
          v_order.user_id, v_order.reference_code, 'active', now(),
          now() + make_interval(months => v_months),
          v_order.total_amount, v_order.currency, 'purchase', v_order.order_number,
          jsonb_build_object('order_id', v_order.id)
        );
      end if;

      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_order.user_id, 'order_paid', 'Modulga kirish huquqi ochildi',
        v_months || ' oylik kirish faollashtirildi. Buyurtma: ' || v_order.order_number,
        jsonb_build_object('order_number', v_order.order_number, 'module', v_order.reference_code),
        '/(app)/survey'
      );
      v_result := jsonb_build_object('module', v_order.reference_code, 'months', v_months);

    -- ----------------------------------------------------- subscription --
    when 'subscription' then
      select * into v_plan from public.subscription_plans where code = v_order.reference_code;
      if not found then
        raise exception 'subscription plan not found: %', v_order.reference_code using errcode = 'P0002';
      end if;

      -- The tariff as sold, frozen with the membership.
      v_snapshot := jsonb_build_object(
        'features', v_plan.features, 'price_amount', v_plan.price_amount,
        'billing_model', v_plan.billing_model, 'included_coins', v_plan.included_coins,
        'presentation_units', v_plan.presentation_units, 'pages_per_unit', v_plan.pages_per_unit,
        'page_multiplier', v_plan.page_multiplier, 'name', v_plan.name, 'period_days', v_plan.period_days);

      if coalesce((v_order.metadata ->> 'restart')::boolean, false) then
        select * into v_subscription from public.user_subscriptions
         where id = public.apply_subscription_restart(v_order.user_id, v_plan.id, v_order.id);
        update public.user_subscriptions set plan_snapshot = v_snapshot
         where id = v_subscription.id returning * into v_subscription;
      else
        select * into v_subscription from public.user_subscriptions
          where user_id = v_order.user_id
            and status in ('active'::public.subscription_status, 'payment_pending'::public.subscription_status)
          order by expires_at desc nulls last
          limit 1
          for update;

        if found then
          select * into v_previous_plan from public.subscription_plans where id = v_subscription.plan_id;
          v_previous_billing := coalesce(v_subscription.plan_snapshot ->> 'billing_model', v_previous_plan.billing_model, 'quota');

          -- PREMIUM's unused decks this period come along as J Tanga, at the
          -- new tariff's price of a ten-page deck.
          if v_previous_billing = 'quota' and v_plan.billing_model = 'coins'
             and v_subscription.status = 'active' and v_subscription.expires_at > now() then
            v_quota := public.quota_status('presentation_weekly', v_order.user_id);
            if coalesce((v_quota ->> 'enabled')::boolean, false) and not coalesce((v_quota ->> 'unlimited')::boolean, false) then
              v_rate := public.presentation_rate(null) || jsonb_build_object(
                'per_page', (public.service_price('presentation')).coins_per_unit * v_plan.page_multiplier);
              v_converted := coalesce((v_quota ->> 'remaining')::integer, 0) * public.coins_for_pages(10, v_rate);
            end if;
          end if;

          update public.user_subscriptions set
            plan_id = v_plan.id,
            status = 'active',
            order_id = v_order.id,
            started_at = coalesce(started_at, now()),
            -- A change from the weekly count to a coin tariff starts the month
            -- now: the count's remainder came along as J Tanga instead.
            expires_at = case when v_previous_billing = 'quota' and v_plan.billing_model = 'coins'
                              then now() + make_interval(days => v_plan.period_days)
                              else greatest(coalesce(expires_at, now()), now()) + make_interval(days => v_plan.period_days) end,
            cancelled_at = null,
            plan_snapshot = v_snapshot
            where id = v_subscription.id
            returning * into v_subscription;
        else
          insert into public.user_subscriptions (
            user_id, plan_id, status, order_id, started_at, expires_at, plan_snapshot
          ) values (
            v_order.user_id, v_plan.id, 'active', v_order.id, now(),
            now() + make_interval(days => v_plan.period_days), v_snapshot
          )
          returning * into v_subscription;
        end if;
      end if;

      if v_plan.billing_model = 'coins' then
        v_lot := public.plan_lot_grant(v_order.user_id, v_subscription.id, v_order, v_plan.code,
                                       v_plan.included_coins, v_converted, v_subscription.expires_at);
      end if;

      v_result := jsonb_build_object(
        'plan', v_plan.code, 'expires_at', v_subscription.expires_at,
        'subscription_id', v_subscription.id,
        'restarted', coalesce((v_order.metadata ->> 'restart')::boolean, false),
        'plan_coins', v_lot);

      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_order.user_id, 'order_paid',
        case when coalesce((v_order.metadata ->> 'restart')::boolean, false)
             then 'Tarif qayta boshlandi' else 'Tarif faollashtirildi' end,
        coalesce(v_order.metadata ->> 'label', v_order.reference_code)
          || case when v_lot is not null then ' — ' || (v_lot ->> 'plan_coins') || ' J Tanga' else '' end
          || ' — buyurtma ' || v_order.order_number,
        jsonb_build_object('order_number', v_order.order_number, 'plan', v_order.reference_code, 'plan_coins', v_lot),
        '/(app)/(tabs)/profile'
      );

    -- ------------------------------------------------------ marathon votes --
    when 'marathon_votes' then
      v_result := public.marathon_fulfil_vote_sale(v_order.id);

    -- ------------------------------------------------------ marketplace --
    else
      select * into v_transaction from public.payment_transactions
        where order_id = v_order.id;

      if not found then
        insert into public.payment_transactions (
          buyer_id, product_id, seller_id, order_id, state,
          base_price, currency,
          buyer_fee_rate, buyer_fee_amount, buyer_total,
          seller_fee_rate, seller_fee_amount, seller_net, platform_gross,
          provider_cost, provider_receipt_id, idempotency_key
        ) values (
          v_order.user_id, v_order.product_id, v_order.seller_id, v_order.id, 'processing',
          v_order.subtotal, v_order.currency,
          v_order.buyer_fee_rate, v_order.buyer_fee, v_order.total_amount,
          v_order.seller_fee_rate, v_order.seller_fee, v_order.seller_net, v_order.platform_revenue,
          greatest(coalesce(p_provider_cost, 0), 0), p_payme_receipt_id,
          'order:' || v_order.order_number
        )
        returning * into v_transaction;
      end if;

      if not exists (
        select 1 from public.marketplace_purchases
        where buyer_id = v_order.user_id and product_id = v_order.product_id
      ) then
        perform public.marketplace_settle_payment(v_transaction.id);
      end if;

      v_result := jsonb_build_object('product_id', v_order.product_id);
  end case;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'purpose', v_order.purpose,
    'already', false
  ) || v_result;
end;
$$;

/* ---------------------------------------------------------------- wallet */

/**
 * Everything the app shows about someone's means, in one call: the J Tanga
 * balance and how much of it is this month's tariff, the welcome and bought
 * presentation pages, the tariff, and what a ten-page deck costs them now.
 */
create or replace function public.my_wallet()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.credit_wallets%rowtype;
  v_lot public.coin_lots%rowtype;
  v_rate jsonb;
  v_sub public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_welcome record;
  v_bought record;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.expire_coin_lots(v_user);

  select * into v_wallet from public.credit_wallets where user_id = v_user;
  select * into v_lot from public.coin_lots where user_id = v_user and status = 'active';
  v_rate := public.presentation_rate(v_user);

  select coalesce(sum(pages_granted), 0) as granted, coalesce(sum(pages_remaining), 0) as remaining,
         coalesce(sum(pages_reserved), 0) as reserved
    into v_welcome
    from public.presentation_credit_grants
   where user_id = v_user and source = 'welcome' and (expires_at is null or expires_at > now());
  select coalesce(sum(pages_remaining), 0) as remaining, coalesce(sum(pages_reserved), 0) as reserved
    into v_bought
    from public.presentation_credit_grants
   where user_id = v_user and source <> 'welcome' and (expires_at is null or expires_at > now());

  select s.* into v_sub from public.user_subscriptions s
   where s.user_id = v_user and s.status = 'active' and s.expires_at > now()
   order by s.expires_at desc limit 1;
  if v_sub.id is not null then
    select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
  end if;

  return jsonb_build_object(
    'balance', coalesce(v_wallet.balance, 0),
    'reserved', coalesce(v_wallet.reserved, 0),
    'plan_coins', case when v_lot.id is not null and v_lot.expires_at > now() then v_lot.remaining else 0 end,
    'plan_coins_expire_at', v_lot.expires_at,
    'welcome', jsonb_build_object(
      'granted', v_welcome.granted, 'remaining', v_welcome.remaining, 'reserved', v_welcome.reserved,
      'decks', floor(v_welcome.remaining / 10.0)::integer),
    'presentation_pages', jsonb_build_object('remaining', v_bought.remaining, 'reserved', v_bought.reserved),
    'plan', case when v_sub.id is null then null else jsonb_build_object(
      'code', v_plan.code, 'name', v_plan.name, 'name_i18n', v_plan.name_i18n,
      'billing', coalesce(v_sub.plan_snapshot ->> 'billing_model', v_plan.billing_model, 'quota'),
      'expires_at', v_sub.expires_at) end,
    'rate', jsonb_build_object(
      'per_page', round((v_rate ->> 'per_page')::numeric, 6),
      'deck_10', public.coins_for_pages(10, v_rate),
      'multiplier', v_rate -> 'multiplier',
      'version', v_rate -> 'version')
  );
end;
$$;

revoke all on function public.my_wallet() from public, anon;
grant execute on function public.my_wallet() to authenticated;

/* ----------------------------------------------------------------- admin */

/**
 * What would lose money, or let someone buy cheaper than intended, under the
 * prices in force — said, not prevented: the operator may mean it.
 */
create or replace function public.economy_warnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_econ public.economy_versions%rowtype := public.economy_current();
  v_price public.service_prices%rowtype := public.service_price('presentation');
  v_plan public.subscription_plans%rowtype;
  v_package public.coin_packages%rowtype;
  v_deck integer;
  v_out jsonb := '[]'::jsonb;
  v_lowest numeric;
begin
  for v_plan in select * from public.subscription_plans where billing_model = 'coins' and is_active loop
    v_deck := public.coins_round(v_plan.pages_per_unit * v_price.coins_per_unit * v_plan.page_multiplier, v_econ.rounding);
    if v_plan.included_coins < v_plan.presentation_units * v_deck then
      v_out := v_out || jsonb_build_object('level', 'error', 'code', 'plan_allowance_short', 'plan', v_plan.code,
        'message', format('%s: %s J Tanga %s ta taqdimotga yetmaydi (kerak: %s).',
          v_plan.name, v_plan.included_coins, v_plan.presentation_units, v_plan.presentation_units * v_deck));
    end if;
    if v_plan.estimated_cost_amount > 0 and v_plan.estimated_cost_amount >= v_plan.price_amount then
      v_out := v_out || jsonb_build_object('level', 'error', 'code', 'plan_negative_margin', 'plan', v_plan.code,
        'message', format('%s: taxminiy xarajat (%s so‘m) narxdan (%s so‘m) katta.',
          v_plan.name, v_plan.estimated_cost_amount, v_plan.price_amount));
    end if;
  end loop;

  select min(page_multiplier) into v_lowest from public.subscription_plans where billing_model = 'coins' and is_active;
  if v_lowest is not null and v_econ.no_plan_multiplier < (select max(page_multiplier) from public.subscription_plans where billing_model = 'coins' and is_active) then
    v_out := v_out || jsonb_build_object('level', 'warning', 'code', 'no_plan_cheaper',
      'message', 'Tarifsiz foydalanuvchi sahifa uchun ba’zi tarif egalaridan arzonroq to‘laydi.');
  end if;

  for v_package in select * from public.coin_packages where is_active and coins > 0 loop
    if v_package.price_amount / (v_package.coins + v_package.bonus_coins) < v_econ.coin_value_uzs * 0.5 then
      v_out := v_out || jsonb_build_object('level', 'warning', 'code', 'package_below_value', 'package', v_package.code,
        'message', format('%s: bir J Tanga %s so‘mga tushadi — hisob qiymatining (%s) yarmidan arzon.',
          v_package.label, round(v_package.price_amount / (v_package.coins + v_package.bonus_coins), 2), v_econ.coin_value_uzs));
    end if;
  end loop;

  for v_package in select * from public.coin_packages where is_active and presentation_pages > 0 loop
    if v_package.price_amount / v_package.presentation_pages < (v_econ.coin_value_uzs * v_price.coins_per_unit) * 0.5 then
      v_out := v_out || jsonb_build_object('level', 'warning', 'code', 'pages_below_value', 'package', v_package.code,
        'message', format('%s: bir sahifa %s so‘m — J Tanga orqali sahifa narxining yarmidan arzon.',
          v_package.label, round(v_package.price_amount / v_package.presentation_pages, 2)));
    end if;
  end loop;
  return v_out;
end;
$$;

/** The whole economy for the admin panel's pages: prices, history, tariffs, packs, welcome and liability. */
create or replace function public.admin_economy_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current public.economy_versions%rowtype := public.economy_current();
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'current', to_jsonb(v_current),
    'services', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.service) from public.service_prices sp where sp.version_id = v_current.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('version', v.version, 'effective_from', v.effective_from, 'note', v.note,
               'created_at', v.created_at, 'created_by', p.full_name,
               'coin_value_uzs', v.coin_value_uzs, 'no_plan_multiplier', v.no_plan_multiplier, 'rounding', v.rounding)
             order by v.version desc)
        from (select * from public.economy_versions order by version desc limit 30) v
        left join public.profiles p on p.id = v.created_by), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.sort_order) from public.subscription_plans sp), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(cp) order by cp.sort_order) from public.coin_packages cp), '[]'::jsonb),
    'welcome', jsonb_build_object(
      'settings', v_current.welcome,
      'accounts', (select count(*) from public.presentation_credit_grants where source = 'welcome'),
      'pages_granted', (select coalesce(sum(pages_granted), 0) from public.presentation_credit_grants where source = 'welcome'),
      'pages_left', (select coalesce(sum(pages_remaining + pages_reserved), 0) from public.presentation_credit_grants where source = 'welcome')),
    'liability', jsonb_build_object(
      'coins', (select coalesce(sum(balance + reserved), 0) from public.credit_wallets),
      'plan_coins', (select coalesce(sum(remaining), 0) from public.coin_lots where status = 'active'),
      'bought_pages', (select coalesce(sum(pages_remaining + pages_reserved), 0) from public.presentation_credit_grants where source <> 'welcome'),
      'coin_value_uzs', v_current.coin_value_uzs),
    'warnings', public.economy_warnings()
  );
end;
$$;

/**
 * Publishes a new economy version: the current one with the given changes.
 *
 * Nothing already charged is touched — charges and quotes carry the version
 * they used. Super admins only: this sets what everybody pays.
 */
create or replace function public.admin_publish_economy(p_settings jsonb, p_services jsonb default '{}'::jsonb, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_current public.economy_versions%rowtype := public.economy_current();
  v_next public.economy_versions%rowtype;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_service public.service_prices%rowtype;
  v_change jsonb;
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.economy_versions (
    version, coin_value_uzs, rounding, no_plan_multiplier, min_charge, max_charge, welcome, note, effective_from, created_by
  ) values (
    (select coalesce(max(version), 0) + 1 from public.economy_versions),
    coalesce((v_settings ->> 'coin_value_uzs')::numeric, v_current.coin_value_uzs),
    coalesce(v_settings ->> 'rounding', v_current.rounding),
    coalesce((v_settings ->> 'no_plan_multiplier')::numeric, v_current.no_plan_multiplier),
    coalesce((v_settings ->> 'min_charge')::integer, v_current.min_charge),
    coalesce((v_settings ->> 'max_charge')::integer, v_current.max_charge),
    v_current.welcome || coalesce(v_settings -> 'welcome', '{}'::jsonb),
    left(coalesce(p_note, ''), 500),
    greatest(coalesce((v_settings ->> 'effective_from')::timestamptz, now()), now()),
    v_admin
  )
  returning * into v_next;

  for v_service in select * from public.service_prices where version_id = v_current.id loop
    v_change := coalesce(p_services -> v_service.service, '{}'::jsonb);
    insert into public.service_prices (
      version_id, service, unit, coins_per_unit, ai_markup, min_units, max_units, min_charge, max_charge,
      promo_percent, promo_until, is_enabled
    ) values (
      v_next.id, v_service.service, v_service.unit,
      coalesce((v_change ->> 'coins_per_unit')::numeric, v_service.coins_per_unit),
      coalesce((v_change ->> 'ai_markup')::numeric, v_service.ai_markup),
      coalesce((v_change ->> 'min_units')::integer, v_service.min_units),
      coalesce((v_change ->> 'max_units')::integer, v_service.max_units),
      coalesce((v_change ->> 'min_charge')::integer, v_service.min_charge),
      coalesce((v_change ->> 'max_charge')::integer, v_service.max_charge),
      coalesce((v_change ->> 'promo_percent')::numeric, v_service.promo_percent),
      case when v_change ? 'promo_until' then (v_change ->> 'promo_until')::timestamptz else v_service.promo_until end,
      coalesce((v_change ->> 'is_enabled')::boolean, v_service.is_enabled)
    );
  end loop;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'economy.published', 'economy_version', v_next.version::text,
          jsonb_build_object('version', v_current.version, 'settings', to_jsonb(v_current)),
          jsonb_build_object('version', v_next.version, 'settings', to_jsonb(v_next), 'services', p_services),
          left(coalesce(p_note, ''), 500));

  return jsonb_build_object('version', v_next.version, 'effective_from', v_next.effective_from,
                            'warnings', public.economy_warnings());
end;
$$;

/** A tariff's economy: how it bills, what it grants, its rate, and its words in three languages. */
create or replace function public.admin_save_plan_economy(p_plan_id uuid, p_payload jsonb)
returns public.subscription_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_plan public.subscription_plans%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select to_jsonb(row) into v_before from public.subscription_plans row where row.id = p_plan_id;
  if v_before is null then raise exception 'plan_not_found' using errcode = '02000'; end if;

  update public.subscription_plans set
    billing_model = coalesce(v_payload ->> 'billing_model', billing_model),
    included_coins = coalesce((v_payload ->> 'included_coins')::integer, included_coins),
    presentation_units = coalesce((v_payload ->> 'presentation_units')::integer, presentation_units),
    pages_per_unit = coalesce((v_payload ->> 'pages_per_unit')::integer, pages_per_unit),
    page_multiplier = coalesce((v_payload ->> 'page_multiplier')::numeric, page_multiplier),
    name_i18n = coalesce(v_payload -> 'name_i18n', name_i18n),
    description_i18n = coalesce(v_payload -> 'description_i18n', description_i18n),
    badge_i18n = coalesce(v_payload -> 'badge_i18n', badge_i18n),
    is_visible = coalesce((v_payload ->> 'is_visible')::boolean, is_visible),
    updated_at = now()
  where id = p_plan_id
  returning * into v_plan;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, 'plan.economy_edited', 'subscription_plan', v_plan.id::text, v_before, to_jsonb(v_plan));
  return v_plan;
end;
$$;

/** Creates or edits a pack of J Tanga or of presentation pages. */
create or replace function public.admin_save_package(p_payload jsonb)
returns public.coin_packages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid := nullif(v_payload ->> 'id', '')::uuid;
  v_before jsonb;
  v_package public.coin_packages%rowtype;
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_id is not null then
    select to_jsonb(row) into v_before from public.coin_packages row where row.id = v_id;
    if v_before is null then raise exception 'package_not_found' using errcode = '02000'; end if;
    update public.coin_packages set
      code = coalesce(v_payload ->> 'code', code),
      label = coalesce(v_payload ->> 'label', label),
      description = coalesce(v_payload ->> 'description', description),
      coins = coalesce((v_payload ->> 'coins')::integer, coins),
      bonus_coins = coalesce((v_payload ->> 'bonus_coins')::integer, bonus_coins),
      presentation_pages = coalesce((v_payload ->> 'presentation_pages')::integer, presentation_pages),
      price_amount = coalesce((v_payload ->> 'price_amount')::numeric, price_amount),
      sort_order = coalesce((v_payload ->> 'sort_order')::integer, sort_order),
      is_active = coalesce((v_payload ->> 'is_active')::boolean, is_active),
      purchase_limit = case when v_payload ? 'purchase_limit' then nullif(v_payload ->> 'purchase_limit', '')::integer else purchase_limit end,
      starts_at = case when v_payload ? 'starts_at' then nullif(v_payload ->> 'starts_at', '')::timestamptz else starts_at end,
      ends_at = case when v_payload ? 'ends_at' then nullif(v_payload ->> 'ends_at', '')::timestamptz else ends_at end,
      label_i18n = coalesce(v_payload -> 'label_i18n', label_i18n),
      description_i18n = coalesce(v_payload -> 'description_i18n', description_i18n),
      updated_by = v_admin,
      updated_at = now()
    where id = v_id
    returning * into v_package;
  else
    insert into public.coin_packages (
      code, label, description, coins, bonus_coins, presentation_pages, price_amount, currency, sort_order, is_active,
      purchase_limit, starts_at, ends_at, label_i18n, description_i18n, updated_by
    ) values (
      v_payload ->> 'code', v_payload ->> 'label', coalesce(v_payload ->> 'description', ''),
      coalesce((v_payload ->> 'coins')::integer, 0), coalesce((v_payload ->> 'bonus_coins')::integer, 0),
      coalesce((v_payload ->> 'presentation_pages')::integer, 0),
      coalesce((v_payload ->> 'price_amount')::numeric, 0), 'UZS',
      coalesce((v_payload ->> 'sort_order')::integer, 0), coalesce((v_payload ->> 'is_active')::boolean, true),
      nullif(v_payload ->> 'purchase_limit', '')::integer,
      nullif(v_payload ->> 'starts_at', '')::timestamptz, nullif(v_payload ->> 'ends_at', '')::timestamptz,
      coalesce(v_payload -> 'label_i18n', '{}'::jsonb), coalesce(v_payload -> 'description_i18n', '{}'::jsonb), v_admin
    )
    returning * into v_package;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, case when v_before is null then 'package.created' else 'package.edited' end,
          'coin_package', v_package.id::text, v_before, to_jsonb(v_package));
  return v_package;
end;
$$;

/** Presentation pages given by an operator — a goodwill gesture or a correction — with a reason. */
create or replace function public.admin_grant_presentation_pages(p_user_id uuid, p_pages integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_grant uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_pages, 0) <= 0 or p_pages > 1000 then
    raise exception 'pages must be between 1 and 1000' using errcode = '22023';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  insert into public.presentation_credit_grants (user_id, source, pages_granted, pages_remaining, granted_by, note)
  values (p_user_id, 'admin', p_pages, p_pages, v_admin, left(p_note, 300))
  returning id into v_grant;
  insert into public.presentation_credit_ledger (user_id, grant_id, kind, pages, idempotency_key, metadata)
  values (p_user_id, v_grant, 'grant', p_pages, 'admin:' || v_grant::text, jsonb_build_object('admin_id', v_admin));
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data, reason)
  values (v_admin, 'presentation_pages.granted', 'user', p_user_id::text,
          jsonb_build_object('pages', p_pages, 'grant_id', v_grant), left(p_note, 300));
  insert into public.notifications (user_id, kind, title, body, payload, deep_link)
  values (p_user_id, 'system', p_pages || ' sahifa taqdimot uchun sovg‘a qilindi', left(p_note, 300),
          jsonb_build_object('event', 'presentation_pages_granted', 'pages', p_pages), '/(app)/create');
  return v_grant;
end;
$$;

/**
 * The welcome, given to accounts that existed before it — only when an
 * operator decides so. Each account and each identity still at most once.
 */
create or replace function public.admin_welcome_backfill(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_user record;
  v_given integer := 0;
  v_seen integer := 0;
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for v_user in
    select u.id, coalesce(nullif(u.email, ''), nullif(u.phone, '')) as identity
      from auth.users u
     where not exists (select 1 from public.presentation_credit_grants g where g.user_id = u.id and g.source = 'welcome')
     order by u.created_at
     limit greatest(least(coalesce(p_limit, 500), 5000), 1)
  loop
    v_seen := v_seen + 1;
    if public.grant_welcome_pages(v_user.id, v_user.identity, true) then v_given := v_given + 1; end if;
  end loop;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'welcome.backfilled', 'economy', 'welcome', jsonb_build_object('checked', v_seen, 'granted', v_given));
  return jsonb_build_object('checked', v_seen, 'granted', v_given);
end;
$$;

revoke all on function public.economy_warnings() from public, anon;
revoke all on function public.admin_economy_overview() from public, anon;
revoke all on function public.admin_publish_economy(jsonb, jsonb, text) from public, anon;
revoke all on function public.admin_save_plan_economy(uuid, jsonb) from public, anon;
revoke all on function public.admin_save_package(jsonb) from public, anon;
revoke all on function public.admin_grant_presentation_pages(uuid, integer, text) from public, anon;
revoke all on function public.admin_welcome_backfill(integer) from public, anon;
grant execute on function public.admin_economy_overview() to authenticated;
grant execute on function public.admin_publish_economy(jsonb, jsonb, text) to authenticated;
grant execute on function public.admin_save_plan_economy(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_package(jsonb) to authenticated;
grant execute on function public.admin_grant_presentation_pages(uuid, integer, text) to authenticated;
grant execute on function public.admin_welcome_backfill(integer) to authenticated;

/*
 * Nothing in this file is callable by a signed-out visitor. The helpers
 * the quote and the admin pages are built from are called by them, as their
 * definer, and by nobody else.
 */
revoke all on function public.economy_current() from public, anon, authenticated;
revoke all on function public.service_price(text) from public, anon, authenticated;
revoke all on function public.coins_round(numeric, text) from public, anon, authenticated;
revoke all on function public.coins_for_pages(integer, jsonb) from public, anon, authenticated;
revoke all on function public.coin_lot_track() from public, anon, authenticated;
