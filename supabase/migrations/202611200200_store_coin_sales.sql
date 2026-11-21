-- Selling in the store for J Tanga, and a platform fee on J Tanga transfers.
--
-- The model, in one place:
--
--   * A listing keeps its so‘m price (`base_price`, 0 = free, exactly as
--     before) and may carry a second price in J Tanga (`coin_price`). The coin
--     price is an extra way to pay for a paid listing, never a replacement for
--     the so‘m price: "free" keeps meaning `base_price = 0` everywhere, the
--     apps in the stores today keep selling the same listings for so‘m, and no
--     report that sums so‘m ever meets a coin.
--
--   * Whoever pays pays the number they were shown; the platform's share comes
--     out of what the other side receives. A buyer pays the coin price; the
--     seller receives it minus the store fee. A sender sends the amount they
--     typed; the recipient receives it minus the transfer fee. Both fees are a
--     percentage with an optional minimum, rounded once to whole J Tanga, and
--     a percentage of 0 turns the fee off. Admins set them in
--     `marketplace.coin_sales` and `coins.transfer` (admin_set_coin_fees).
--
--   * Every movement is a ledger row: the payer's row in `credit_transactions`
--     (marketplace_spend / transfer_out), the receiver's row
--     (marketplace_earn / transfer_in) and the platform's share in
--     `coin_platform_fees`. The three always sum to zero, so a fee is coins
--     leaving circulation, never coins appearing from nowhere.
--
--   * A coin sale is final, like a so‘m sale: the refund policy a buyer agrees
--     to is the same one, and nothing in the money flow reverses a sale, so
--     nothing here does either.
--
--   * A tariff's J Tanga stay with the person whose tariff it is. A transfer
--     already may not send them; buying from somebody else's listing would
--     hand them over just the same, so they cannot pay for a coin purchase.
--
-- Nothing in this file is applied to production by itself; it ships with the
-- app release that shows the coin price.

-- ------------------------------------------------------------------ settings --
insert into public.app_settings (key, value, description, public_read)
values (
  'marketplace.coin_sales',
  '{"enabled": true, "fee_percent": 20, "fee_min": 0, "min_price": 1, "max_price": 100000}'::jsonb,
  'Store sales paid in J Tanga: whether they are open, the platform fee taken from what the seller receives (percent, optional minimum in J; 0 percent = no fee), and the coin price range a seller may set.',
  true
)
on conflict (key) do nothing;

-- The transfer fee joins the transfer bounds. Merged in only where missing, so
-- whatever the operator already set for the bounds stays as it is; shipped at
-- 0 percent, so transfers behave exactly as before until an admin sets a fee.
update public.app_settings
   set value = '{"fee_percent": 0, "fee_min": 0}'::jsonb || value,
       description = 'Bounds and platform fee applied by transfer_credits() to person-to-person J Tanga transfers. The fee (percent, optional minimum in J; 0 percent = no fee) comes out of what the recipient receives.'
 where key = 'coins.transfer';

/**
 * The store's coin settings, read defensively. A value an admin typed into the
 * generic settings editor in the wrong shape reads as "off" or as the default
 * bound, never as an error in the middle of somebody's purchase.
 */
create or replace function public.coin_sales_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce(s.value ->> 'enabled' = 'true', false),
    'min_price', case when s.value ->> 'min_price' ~ '^[0-9]{1,8}$'
                      then greatest((s.value ->> 'min_price')::integer, 1) else 1 end,
    'max_price', case when s.value ->> 'max_price' ~ '^[0-9]{1,8}$'
                      then least(greatest((s.value ->> 'max_price')::integer, 1), 10000000) else 100000 end
  )
  from (select (select value from public.app_settings where key = 'marketplace.coin_sales') as value) as s;
$$;

/**
 * What a platform fee is on a given amount, and what is left after it.
 *
 * The one place the fee arithmetic lives, for both scopes: `store` (a coin
 * sale; the seller receives `net`) and `transfer` (a person-to-person send;
 * the recipient receives `net`). Rounded once, half up, to a whole J Tanga;
 * the minimum applies only when a percentage is set; a fee never exceeds the
 * amount it is taken from. Callers store the result rather than recompute it.
 */
create or replace function public.coin_fee_quote(p_scope text, p_amount integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_percent numeric := 0;
  v_min integer := 0;
  v_amount integer := greatest(coalesce(p_amount, 0), 0);
  v_fee integer := 0;
begin
  if p_scope is null or p_scope not in ('store', 'transfer') then
    raise exception 'unknown fee scope %', p_scope using errcode = '22023';
  end if;

  select value into v_settings from public.app_settings
   where key = case p_scope when 'store' then 'marketplace.coin_sales' else 'coins.transfer' end;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  if v_settings ->> 'fee_percent' ~ '^[0-9]{1,3}(\.[0-9]+)?$' then
    v_percent := round(least((v_settings ->> 'fee_percent')::numeric, 100), 2);
  end if;
  if v_settings ->> 'fee_min' ~ '^[0-9]{1,8}$' then
    v_min := (v_settings ->> 'fee_min')::integer;
  end if;

  if v_percent > 0 and v_amount > 0 then
    v_fee := least(v_amount, greatest(v_min, round(v_amount * v_percent / 100)::integer));
  end if;

  return jsonb_build_object(
    'scope', p_scope,
    'amount', v_amount,
    'fee_percent', v_percent,
    'fee_min', v_min,
    'fee', v_fee,
    'net', v_amount - v_fee
  );
end;
$$;

comment on function public.coin_fee_quote(text, integer) is
  'The one place J Tanga platform-fee arithmetic lives (store sales and transfers). Purchases and transfers snapshot its output.';

-- -------------------------------------------------------------- coin price --
alter table public.marketplace_products add column if not exists coin_price integer;
alter table public.marketplace_products drop constraint if exists marketplace_products_coin_price;
alter table public.marketplace_products add constraint marketplace_products_coin_price
  check (coin_price is null or coin_price between 1 and 10000000);

comment on column public.marketplace_products.coin_price is
  'An optional second price in whole J Tanga for a paid listing. Null: not sold for coins. A free listing (base_price 0) never has one.';

/**
 * A free listing is taken, not bought, in any currency. Every path that makes a
 * listing free — the seller's form, the fast publish of a deck, auto-publish —
 * therefore drops its coin price here rather than each remembering to.
 */
create or replace function public.marketplace_coin_price_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_price = 0 then
    new.coin_price := null;
  end if;
  return new;
end;
$$;

drop trigger if exists marketplace_products_coin_price_guard on public.marketplace_products;
create trigger marketplace_products_coin_price_guard
  before insert or update of base_price, coin_price on public.marketplace_products
  for each row execute function public.marketplace_coin_price_guard();

/**
 * Approval covers what a buyer decides on, and a coin price is a price. Setting
 * or changing it sends a live listing back to review, as a so‘m price change
 * does; taking it away only removes a way to pay, so it does not.
 */
create or replace function public.marketplace_reopen_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved'::public.marketplace_product_status
     and new.status = old.status
     and (
       new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.base_price is distinct from old.base_price
       or (new.coin_price is distinct from old.coin_price and new.coin_price is not null)
       or new.material_type is distinct from old.material_type
       or new.category_id is distinct from old.category_id
       or new.cover_path is distinct from old.cover_path
       or new.has_study_guide is distinct from old.has_study_guide
       or new.game_id is distinct from old.game_id
     )
  then
    new.status := 'pending_review'::public.marketplace_product_status;
    new.published_at := null;
    new.moderated_by := null;
    new.moderated_at := null;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------ coin purchases --
/**
 * A completed sale paid in J Tanga, with the fee it was made of.
 *
 * Its own table rather than a row in `marketplace_purchases`: that table, its
 * seller ledger and every finance report on top of them count so‘m that a
 * provider moved and an accountant pays out. Coins never reach a payout; they
 * land in the seller's wallet at once.
 *
 * People are held with `restrict`, like the so‘m purchase's seller: this is a
 * record with two parties in it, and deleting an account must not take the
 * other party's receipt (or the buyer's access) with it.
 */
create table public.marketplace_coin_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references public.marketplace_products(id) on delete restrict,
  price integer not null,
  fee_percent numeric(5,2) not null,
  fee_min integer not null default 0,
  fee_amount integer not null,
  seller_net integer not null,
  idempotency_key text not null,
  buyer_transaction_id uuid not null references public.credit_transactions(id) on delete restrict,
  -- Null only when the fee took the whole price: a ledger row must move coins.
  seller_transaction_id uuid references public.credit_transactions(id) on delete restrict,
  refund_ack jsonb not null default '{}'::jsonb,
  purchased_at timestamptz not null default now(),
  -- A retried request is the same purchase, not a second one.
  unique (buyer_id, idempotency_key),
  -- One person owns a listing once.
  unique (buyer_id, product_id),
  constraint marketplace_coin_purchases_amounts check (
    price >= 1 and fee_amount >= 0 and seller_net >= 0 and price = fee_amount + seller_net
  ),
  constraint marketplace_coin_purchases_fee check (fee_percent between 0 and 100 and fee_min >= 0),
  constraint marketplace_coin_purchases_parties check (buyer_id <> seller_id),
  constraint marketplace_coin_purchases_seller_row check ((seller_transaction_id is null) = (seller_net = 0))
);

create index if not exists marketplace_coin_purchases_seller_idx on public.marketplace_coin_purchases (seller_id, purchased_at desc);
create index if not exists marketplace_coin_purchases_product_idx on public.marketplace_coin_purchases (product_id);
create index if not exists marketplace_coin_purchases_period_idx on public.marketplace_coin_purchases (purchased_at desc);

comment on table public.marketplace_coin_purchases is
  'Store sales paid in J Tanga. The buyer paid price; the seller received seller_net; fee_amount went to the platform (coin_platform_fees). Final, like a so‘m sale.';

alter table public.marketplace_coin_purchases enable row level security;

-- Both sides of the sale read it, as they do a so‘m purchase. Nobody writes it
-- but the purchase function.
drop policy if exists marketplace_coin_purchases_select on public.marketplace_coin_purchases;
create policy marketplace_coin_purchases_select on public.marketplace_coin_purchases for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.marketplace_coin_purchases from anon, authenticated;
grant select on public.marketplace_coin_purchases to authenticated, service_role;

-- --------------------------------------------------------- platform's share --
/**
 * The platform's share of every J Tanga movement that carried a fee, one row
 * per movement. With the payer's and the receiver's `credit_transactions` rows
 * it sums to zero, which is how a fee can be audited rather than inferred.
 */
create table public.coin_platform_fees (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  amount integer not null,
  gross_amount integer not null,
  fee_percent numeric(5,2) not null,
  fee_min integer not null default 0,
  /** Whose wallet the coins left (the buyer, the sender). */
  from_user_id uuid references auth.users(id) on delete set null,
  /** Who received the rest (the seller, the recipient). */
  to_user_id uuid references auth.users(id) on delete set null,
  coin_purchase_id uuid references public.marketplace_coin_purchases(id) on delete restrict,
  /** The payer's ledger row the fee was part of. */
  credit_transaction_id uuid references public.credit_transactions(id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint coin_platform_fees_source check (source in ('store_sale', 'transfer')),
  constraint coin_platform_fees_amounts check (amount > 0 and gross_amount >= amount),
  constraint coin_platform_fees_rate check (fee_percent between 0 and 100 and fee_min >= 0),
  constraint coin_platform_fees_purchase check ((source = 'store_sale') = (coin_purchase_id is not null))
);

create index if not exists coin_platform_fees_period_idx on public.coin_platform_fees (created_at desc);
create index if not exists coin_platform_fees_source_idx on public.coin_platform_fees (source, created_at desc);

alter table public.coin_platform_fees enable row level security;

drop policy if exists coin_platform_fees_select on public.coin_platform_fees;
create policy coin_platform_fees_select on public.coin_platform_fees for select to authenticated
  using ((select public.is_admin()));

revoke all on public.coin_platform_fees from anon, authenticated;
grant select on public.coin_platform_fees to authenticated, service_role;

/**
 * Why an account cannot be erased outright (see 202608300001), now including a
 * sale in J Tanga on either side: the other party's receipt names this person,
 * and the `restrict` keys above would otherwise meet the deletion as an error.
 */
create or replace function public.account_retention_reasons(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(reason), '{}'::text[])
  from (
    -- Sold something. The buyer's receipt names this seller.
    select 'marketplace_sales' as reason
     where exists (select 1 from public.marketplace_purchases where seller_id = p_user)
    union all
    select 'payments_received'
     where exists (select 1 from public.payment_transactions where seller_id = p_user)
    union all
    select 'orders_fulfilled'
     where exists (select 1 from public.orders where seller_id = p_user)
    union all
    select 'seller_settlements'
     where exists (select 1 from public.seller_settlements where seller_id = p_user)
    -- Sold or bought for J Tanga: the sale names both people.
    union all
    select 'marketplace_coin_sales'
     where exists (select 1 from public.marketplace_coin_purchases where seller_id = p_user)
    union all
    select 'marketplace_coin_purchases'
     where exists (select 1 from public.marketplace_coin_purchases where buyer_id = p_user)
    -- Paid for something. A payment the platform actually took is a record the
    -- platform has to be able to produce later; an abandoned checkout is not,
    -- which is why the states are named rather than the table merely counted.
    union all
    select 'payments_made'
     where exists (
       select 1 from public.orders
        where user_id = p_user and status in ('paid', 'refunded')
     )
    union all
    select 'card_payments_made'
     where exists (
       select 1 from public.payment_transactions
        where buyer_id = p_user and state in ('paid', 'refunded')
     )
    union all
    select 'admin_audit_trail'
     where exists (select 1 from public.admin_audit_logs where admin_id = p_user)
  ) as reasons;
$$;

-- ------------------------------------------------------------- entitlements --
-- A coin purchase unlocks exactly what a so‘m purchase does, through the same
-- table every gate already reads (downloads, hosting a bought game, presenting).
alter table public.purchase_entitlements
  add column if not exists coin_purchase_id uuid references public.marketplace_coin_purchases(id) on delete cascade;
alter table public.purchase_entitlements drop constraint if exists purchase_entitlements_source;
alter table public.purchase_entitlements add constraint purchase_entitlements_source
  check (
    source in ('purchase', 'free', 'coins')
    and ((source = 'purchase') = (purchase_id is not null))
    and ((source = 'coins') = (coin_purchase_id is not null))
  );

comment on column public.purchase_entitlements.source is
  'purchase: bought for so‘m (purchase_id set); coins: bought for J Tanga (coin_purchase_id set); free: taken from a free listing (neither).';

-- ------------------------------------------------------------ tariff coins --
/**
 * Keeps a lot's `remaining` true as the wallet moves (see 202610160002).
 *
 * The change: a store purchase in J Tanga is treated like a transfer. It hands
 * the coins to another person, so it may spend what was bought or earned and
 * never this month's tariff — otherwise buying a friend's listing would be a
 * way to send tariff coins after all. Like a transfer, it leaves the lot alone.
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

  if new.type in ('transfer_out'::public.credit_transaction_type, 'marketplace_spend'::public.credit_transaction_type) then
    if new.balance_after < v_lot.remaining then
      if new.type = 'marketplace_spend'::public.credit_transaction_type then
        raise exception 'Tarif J Tangalarini do‘konda sarflab bo‘lmaydi. Sarflash mumkin: % J.',
          greatest(new.balance_after - new.amount - v_lot.remaining, 0)
          using errcode = 'P0001', detail = 'plan_coins_not_spendable';
      end if;
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

-- ----------------------------------------------------------- seller tools --
/**
 * Sets, changes or removes a listing's coin price. The seller's form calls it
 * right after creating the listing, and the product page calls it to edit one.
 *
 * Setting a price is selling, so it needs what selling needs (a tariff with
 * the store's selling feature). Removing one is always allowed.
 */
create or replace function public.marketplace_set_coin_price(p_product_id uuid, p_coin_price integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_settings jsonb := public.coin_sales_settings();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id for update;
  if not found or v_product.seller_id <> v_user then
    raise exception 'Mahsulot topilmadi.' using errcode = 'P0002';
  end if;

  if p_coin_price is not null then
    perform public.assert_marketplace_member('sell');
    if v_product.base_price = 0 then
      raise exception 'Tekin mahsulotga J Tanga narxi qo‘yilmaydi.' using errcode = '22023', detail = 'free_listing';
    end if;
    if p_coin_price < (v_settings ->> 'min_price')::integer or p_coin_price > (v_settings ->> 'max_price')::integer then
      raise exception 'J Tanga narxi % – % J oralig‘ida bo‘lsin.', v_settings ->> 'min_price', v_settings ->> 'max_price'
        using errcode = '22023', detail = 'coin_price_range';
    end if;
  end if;

  if p_coin_price is distinct from v_product.coin_price then
    update public.marketplace_products set coin_price = p_coin_price where id = p_product_id
    returning * into v_product;
  end if;

  return jsonb_build_object('product_id', v_product.id, 'coin_price', v_product.coin_price, 'status', v_product.status);
end;
$$;

-- --------------------------------------------------------------- the quote --
/**
 * What paying for one listing in J Tanga looks like for the caller, right now:
 * the price, the balance before and after, and whether it is enough.
 *
 * The confirmation sheet draws these numbers rather than computing them, so
 * what somebody agrees to is what the server will charge. A tariff month that
 * has run out is burned first, exactly as the wallet screen does, so the
 * balance shown is the balance the purchase will meet.
 */
create or replace function public.marketplace_coin_quote(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_balance integer;
  v_plan integer;
  v_price integer;
  v_spendable integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found or not public.marketplace_can_see_product(p_product_id, v_user) then
    raise exception 'Mahsulot topilmadi.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.coin_lots where user_id = v_user and status = 'active' and expires_at <= now()) then
    perform public.expire_coin_lots(v_user);
  end if;

  select coalesce((select balance from public.credit_wallets where user_id = v_user), 0) into v_balance;
  select coalesce(sum(remaining), 0)::integer into v_plan from public.coin_lots where user_id = v_user and status = 'active';
  v_price := coalesce(v_product.coin_price, 0);
  v_spendable := greatest(v_balance - v_plan, 0);

  return jsonb_build_object(
    'product_id', v_product.id,
    'coin_price', v_product.coin_price,
    'available', coalesce((public.coin_sales_settings() ->> 'enabled')::boolean, false)
                 and v_product.status = 'approved'::public.marketplace_product_status
                 and v_product.base_price > 0 and v_product.coin_price is not null,
    'owned', public.marketplace_has_entitlement(p_product_id, v_user),
    'own', v_product.seller_id = v_user,
    'balance', v_balance,
    'plan_coins', v_plan,
    'spendable', v_spendable,
    'balance_after', v_balance - v_price,
    'enough', v_price > 0 and v_spendable >= v_price,
    'shortfall', greatest(v_price - v_spendable, 0)
  );
end;
$$;

-- ----------------------------------------------------------- the purchase --
/**
 * Buys a listing with J Tanga, in one transaction.
 *
 * Checks, debits the buyer, credits the seller less the store fee, records the
 * platform's share, grants the entitlement and tells both sides — or none of
 * it happens. Both wallets are locked in id order (as transfers lock them), so
 * a purchase and a transfer between the same two people queue instead of
 * deadlocking; ownership and the balance are checked after the locks, so two
 * taps cannot both get through.
 *
 * `p_idempotency_key` makes a retry the same purchase: the same key answers
 * with the first result and charges nothing. `p_expected_price` is the coin
 * price the buyer was shown; if the seller changed it since, the purchase is
 * refused rather than charging a number nobody agreed to.
 */
create or replace function public.marketplace_buy_with_coins(
  p_product_id uuid,
  p_idempotency_key text,
  p_expected_price integer,
  p_refund_acknowledged boolean default false,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_key text;
  v_existing public.marketplace_coin_purchases%rowtype;
  v_product public.marketplace_products%rowtype;
  v_fee_quote jsonb;
  v_price integer;
  v_fee integer;
  v_net integer;
  v_ack jsonb;
  v_buyer_wallet public.credit_wallets%rowtype;
  v_seller_wallet public.credit_wallets%rowtype;
  v_plan integer;
  v_purchase_id uuid := gen_random_uuid();
  v_buyer_tx uuid;
  v_seller_tx uuid;
begin
  if v_buyer is null then raise exception 'authentication required' using errcode = '28000'; end if;
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null or char_length(v_key) > 200 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  -- A retry of a purchase that went through answers as it did, before any
  -- rule below could read "you already own this" as a failure.
  select * into v_existing from public.marketplace_coin_purchases where buyer_id = v_buyer and idempotency_key = v_key;
  if found then
    if v_existing.product_id <> p_product_id then
      raise exception 'idempotency key was used for another purchase' using errcode = '22023';
    end if;
    return jsonb_build_object('applied', false, 'purchase_id', v_existing.id, 'product_id', v_existing.product_id,
      'price', v_existing.price, 'balance', (select balance from public.credit_wallets where user_id = v_buyer));
  end if;

  if exists (select 1 from public.profiles where id = v_buyer and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
  -- Where the store is closed to purchases (the iOS build without in-app
  -- purchase), it is closed to coin purchases as well.
  perform public.assert_payment_allowed(p_platform, 'marketplace');
  if not coalesce((public.coin_sales_settings() ->> 'enabled')::boolean, false) then
    raise exception 'J Tanga bilan xarid vaqtincha o‘chirilgan.' using errcode = '42501', detail = 'coin_sales_disabled';
  end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;
  if v_product.seller_id = v_buyer then
    raise exception 'O‘z mahsulotingizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if v_product.base_price = 0 or v_product.coin_price is null then
    raise exception 'Bu mahsulot J Tangaga sotilmaydi.' using errcode = '22023', detail = 'no_coin_price';
  end if;
  if p_expected_price is null or p_expected_price <> v_product.coin_price then
    raise exception 'J Tanga narxi o‘zgardi: endi % J. Qaytadan tasdiqlang.', v_product.coin_price
      using errcode = '22023', detail = 'coin_price_changed';
  end if;
  -- A blocked account receives no coins (transfers refuse it the same way).
  if exists (select 1 from public.profiles where id = v_product.seller_id and status = 'blocked') then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;

  -- The same agreement a so‘m purchase asks for, recorded with the purchase.
  v_ack := public.marketplace_refund_ack(p_refund_acknowledged);

  v_price := v_product.coin_price;
  v_fee_quote := public.coin_fee_quote('store', v_price);
  v_fee := (v_fee_quote ->> 'fee')::integer;
  v_net := v_price - v_fee;

  -- A tariff month that has run out burns before anything is counted.
  if exists (select 1 from public.coin_lots where user_id = v_buyer and status = 'active' and expires_at <= now()) then
    perform public.expire_coin_lots(v_buyer);
  end if;

  if v_buyer < v_product.seller_id then
    select * into v_buyer_wallet from public.credit_wallets where user_id = v_buyer for update;
    select * into v_seller_wallet from public.credit_wallets where user_id = v_product.seller_id for update;
  else
    select * into v_seller_wallet from public.credit_wallets where user_id = v_product.seller_id for update;
    select * into v_buyer_wallet from public.credit_wallets where user_id = v_buyer for update;
  end if;
  if v_buyer_wallet.user_id is null or v_seller_wallet.user_id is null then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;

  -- Under the locks: a double tap that raced the first one finds it here.
  select * into v_existing from public.marketplace_coin_purchases where buyer_id = v_buyer and idempotency_key = v_key;
  if found then
    return jsonb_build_object('applied', false, 'purchase_id', v_existing.id, 'product_id', v_existing.product_id,
      'price', v_existing.price, 'balance', v_buyer_wallet.balance);
  end if;
  if public.marketplace_has_entitlement(p_product_id, v_buyer)
     or exists (select 1 from public.marketplace_coin_purchases where buyer_id = v_buyer and product_id = p_product_id) then
    raise exception 'Bu mahsulot allaqachon sizda bor.' using errcode = '22023';
  end if;

  if v_buyer_wallet.balance < v_price then
    raise exception 'insufficient balance' using errcode = '22023', detail = 'insufficient_balance';
  end if;
  select coalesce(sum(remaining), 0)::integer into v_plan from public.coin_lots where user_id = v_buyer and status = 'active';
  if v_buyer_wallet.balance - v_plan < v_price then
    raise exception 'Tarif J Tangalarini do‘konda sarflab bo‘lmaydi. Sarflash mumkin: % J.', greatest(v_buyer_wallet.balance - v_plan, 0)
      using errcode = 'P0001', detail = 'plan_coins_not_spendable';
  end if;

  -- The buyer pays the whole price ...
  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, created_by, metadata
  ) values (
    v_buyer, 'marketplace_spend', -v_price, 0, v_buyer_wallet.balance - v_price, v_buyer_wallet.reserved,
    'store-buy:' || v_key, left('Do‘kon xaridi: ' || v_product.title, 200), v_buyer,
    jsonb_build_object('coin_purchase_id', v_purchase_id, 'product_id', v_product.id, 'seller_id', v_product.seller_id,
                       'price', v_price, 'fee', v_fee, 'seller_net', v_net)
  )
  returning id into v_buyer_tx;

  update public.credit_wallets
     set balance = balance - v_price, version = version + 1
   where user_id = v_buyer;

  -- ... the seller receives it less the fee ...
  if v_net > 0 then
    insert into public.credit_transactions (
      user_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, created_by, metadata
    ) values (
      v_product.seller_id, 'marketplace_earn', v_net, 0, v_seller_wallet.balance + v_net, v_seller_wallet.reserved,
      'store-sale:' || v_purchase_id::text, left('Do‘kon sotuvi: ' || v_product.title, 200), v_buyer,
      jsonb_build_object('coin_purchase_id', v_purchase_id, 'product_id', v_product.id, 'buyer_id', v_buyer,
                         'price', v_price, 'fee', v_fee, 'fee_percent', v_fee_quote -> 'fee_percent')
    )
    returning id into v_seller_tx;

    update public.credit_wallets
       set balance = balance + v_net, version = version + 1
     where user_id = v_product.seller_id;
  end if;

  insert into public.marketplace_coin_purchases (
    id, buyer_id, seller_id, product_id, price, fee_percent, fee_min, fee_amount, seller_net,
    idempotency_key, buyer_transaction_id, seller_transaction_id, refund_ack
  ) values (
    v_purchase_id, v_buyer, v_product.seller_id, v_product.id, v_price,
    (v_fee_quote ->> 'fee_percent')::numeric, (v_fee_quote ->> 'fee_min')::integer, v_fee, v_net,
    v_key, v_buyer_tx, v_seller_tx, coalesce(v_ack, '{}'::jsonb)
  );

  -- ... and the platform keeps the rest, on its own row.
  if v_fee > 0 then
    insert into public.coin_platform_fees (
      source, amount, gross_amount, fee_percent, fee_min, from_user_id, to_user_id,
      coin_purchase_id, credit_transaction_id, idempotency_key
    ) values (
      'store_sale', v_fee, v_price, (v_fee_quote ->> 'fee_percent')::numeric, (v_fee_quote ->> 'fee_min')::integer,
      v_buyer, v_product.seller_id, v_purchase_id, v_buyer_tx, 'store-fee:' || v_purchase_id::text
    );
  end if;

  -- Unlocked through the same row a so‘m purchase writes. A grant an admin
  -- revoked earlier is the one row a person may hold per listing, so it is
  -- reused rather than colliding.
  insert into public.purchase_entitlements (purchase_id, coin_purchase_id, user_id, product_id, source)
  values (null, v_purchase_id, v_buyer, v_product.id, 'coins')
  on conflict (user_id, product_id) do update set
    source = 'coins', purchase_id = null, coin_purchase_id = excluded.coin_purchase_id,
    revoked_at = null, granted_at = now();

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_buyer, 'marketplace_purchase',
    'Xarid muvaffaqiyatli',
    '“' || v_product.title || '” endi kutubxonangizda. To‘landi: ' || v_price || ' J.',
    jsonb_build_object('product_id', v_product.id, 'coin_purchase_id', v_purchase_id, 'coins', v_price),
    '/(app)/marketplace/library', v_purchase_id
  );

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_product.seller_id, 'marketplace_sale',
    'Yangi sotuv',
    '“' || v_product.title || '” J Tangaga sotildi. Hisobingizga tushdi: ' || v_net || ' J.',
    jsonb_build_object('product_id', v_product.id, 'coin_purchase_id', v_purchase_id, 'coins', v_net, 'fee', v_fee),
    '/(app)/earnings', v_purchase_id
  );

  return jsonb_build_object(
    'applied', true,
    'purchase_id', v_purchase_id,
    'product_id', v_product.id,
    'price', v_price,
    'balance_before', v_buyer_wallet.balance,
    'balance', v_buyer_wallet.balance - v_price
  );
end;
$$;

comment on function public.marketplace_buy_with_coins(uuid, text, integer, boolean, text) is
  'The only path that buys a listing with J Tanga: atomic debit, credit less fee, platform fee row, entitlement. Idempotent per buyer key.';

-- --------------------------------------------------------------- transfers --
/**
 * Moves J Tanga between two people in one transaction (see 202608090002).
 *
 * The change: the transfer fee. The sender's balance goes down by exactly the
 * amount they typed; the recipient receives that amount less the fee, and the
 * platform's share is its own `coin_platform_fees` row — the same shape as a
 * coin sale, where the buyer pays the price and the seller receives it less
 * the fee. Everything else is as it was: wallets locked in id order, the
 * balance checked after the lock, the sender's key making a retry a no-op, and
 * the same refusals for oneself, blocked accounts, the bounds and an
 * insufficient balance. A fee of 0 percent leaves transfers exactly as before.
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
  v_fee_quote jsonb;
  v_fee integer;
  v_received integer;
  v_sender_tx uuid;
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
      'fee', coalesce((v_existing.metadata ->> 'fee')::integer, 0),
      'received', coalesce((v_existing.metadata ->> 'received')::integer, abs(v_existing.amount)),
      'balance', v_sender_wallet.balance,
      'transaction_id', v_existing.id,
      'message', 'already sent'
    );
  end if;

  -- The fee is quoted after the replay check, so a retry is answered with what
  -- happened even if an admin changed the fee in between.
  v_fee_quote := public.coin_fee_quote('transfer', p_amount);
  v_fee := (v_fee_quote ->> 'fee')::integer;
  v_received := p_amount - v_fee;
  if v_received <= 0 then
    raise exception 'Komissiyadan so‘ng qabul qiluvchiga J Tanga qolmaydi. Kattaroq miqdor yuboring.'
      using errcode = '22023', detail = 'transfer_below_fee';
  end if;

  if v_sender_wallet.balance < p_amount then
    raise exception 'insufficient balance' using errcode = '22023';
  end if;

  update public.credit_wallets
    set balance = balance - p_amount, version = version + 1
    where user_id = v_sender
    returning * into v_sender_after;

  update public.credit_wallets
    set balance = balance + v_received, version = version + 1
    where user_id = p_recipient_id
    returning * into v_recipient_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    v_sender, 'transfer_out', -p_amount, v_sender_after.balance, v_sender_after.reserved, v_key,
    case when v_note = '' then 'J Coin yuborildi' else v_note end, v_sender,
    jsonb_build_object('counterparty_id', p_recipient_id, 'direction', 'out',
                       'fee', v_fee, 'received', v_received, 'fee_percent', v_fee_quote -> 'fee_percent')
  )
  returning id into v_sender_tx;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    p_recipient_id, 'transfer_in', v_received, v_recipient_after.balance, v_recipient_after.reserved, v_key,
    case when v_note = '' then 'J Coin qabul qilindi' else v_note end, v_sender,
    jsonb_build_object('counterparty_id', v_sender, 'direction', 'in', 'sent', p_amount, 'fee', v_fee)
  );

  if v_fee > 0 then
    insert into public.coin_platform_fees (
      source, amount, gross_amount, fee_percent, fee_min, from_user_id, to_user_id,
      credit_transaction_id, idempotency_key
    ) values (
      'transfer', v_fee, p_amount, (v_fee_quote ->> 'fee_percent')::numeric, (v_fee_quote ->> 'fee_min')::integer,
      v_sender, p_recipient_id, v_sender_tx, 'transfer-fee:' || v_sender::text || ':' || v_key
    );
  end if;

  insert into public.notifications (user_id, kind, title, body, payload, entity_id)
  values (
    p_recipient_id,
    'credit_received',
    v_received || ' J qabul qilindi',
    coalesce(
      nullif(btrim(v_sender_profile.full_name), ''),
      case when v_sender_profile.username is null then 'Foydalanuvchi' else '@' || v_sender_profile.username end
    ) || case when v_note = '' then ' sizga J Coin yubordi.' else ' sizga J Coin yubordi: ' || v_note end,
    jsonb_build_object('amount', v_received, 'sent', p_amount, 'fee', v_fee, 'balance', v_recipient_after.balance, 'sender_id', v_sender),
    v_sender
  );

  return jsonb_build_object(
    'applied', true,
    'amount', p_amount,
    'fee', v_fee,
    'received', v_received,
    'balance', v_sender_after.balance,
    'recipient_balance_changed', true
  );
end;
$$;

comment on function public.transfer_credits(uuid, integer, text, text) is
  'The only path that moves J Tanga between people. Locks both wallets in id order, refuses to overdraw, takes the transfer fee from what the recipient receives, and is idempotent per sender key.';

-- ------------------------------------------------------------ what clients read --
/** One listing, with everything the detail screen renders — now with its coin price. */
create or replace function public.marketplace_product_detail(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not public.marketplace_can_see_product(p_product_id, v_user) then
    raise exception 'product is not available' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_product.id,
      'title', v_product.title,
      'description', v_product.description,
      'status', v_product.status,
      'material_type', v_product.material_type,
      'material_label', (select t.label from public.marketplace_material_types t where t.code = v_product.material_type),
      'supports_editor_import', (select t.supports_editor_import from public.marketplace_material_types t where t.code = v_product.material_type),
      'category_id', v_product.category_id,
      'base_price', v_product.base_price,
      'coin_price', v_product.coin_price,
      'currency', v_product.currency,
      'cover_path', v_product.cover_path,
      'content_units', v_product.content_units,
      'file_format', v_product.file_format,
      'has_study_guide', v_product.has_study_guide,
      'sales_count', v_product.sales_count,
      'rating', case when v_product.rating_count = 0 then null else round(v_product.rating_sum::numeric / v_product.rating_count, 2) end,
      'rating_count', v_product.rating_count,
      'created_at', v_product.created_at,
      'updated_at', v_product.updated_at,
      'is_own', v_product.seller_id = v_user
    ),
    'seller', (
      select jsonb_build_object(
        'id', pr.id,
        'name', coalesce(nullif(btrim(pr.full_name), ''), '—'),
        'username', pr.username,
        'avatar_url', pr.avatar_url,
        'product_count', (select count(*) from public.marketplace_products sp
                          where sp.seller_id = pr.id and sp.status = 'approved'::public.marketplace_product_status)
      ) from public.profiles pr where pr.id = v_product.seller_id
    ),
    -- Preview paths only. The main file and the study guide are never named
    -- here; they are reached through the signing function after a purchase.
    'previews', coalesce((
      select jsonb_agg(jsonb_build_object('path', f.storage_path, 'mime_type', f.mime_type) order by f.position)
      from public.marketplace_product_files f
      where f.product_id = p_product_id and f.kind = 'preview'::public.marketplace_file_kind
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label))
      from public.marketplace_product_tags pt join public.marketplace_tags t on t.id = pt.tag_id
      where pt.product_id = p_product_id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at,
        'author', (select coalesce(nullif(btrim(pr.full_name), ''), '—') from public.profiles pr where pr.id = r.buyer_id)
      ) order by r.created_at desc)
      from (select * from public.marketplace_reviews mr where mr.product_id = p_product_id order by mr.created_at desc limit 20) r
    ), '[]'::jsonb),
    'quote', public.marketplace_quote(v_product.base_price),
    -- Whether coin purchases are open at all; the coin price is shown only then.
    'coin_sales', coalesce((public.coin_sales_settings() ->> 'enabled')::boolean, false),
    'owned', public.marketplace_has_entitlement(p_product_id, v_user),
    'is_favorite', exists (select 1 from public.marketplace_favorites f where f.product_id = p_product_id and f.user_id = v_user)
  );
end;
$$;

/** The catalogue query (see 202608100004) — each card now carries its coin price. */
create or replace function public.marketplace_search(
  p_query text default null,
  p_material_type text default null,
  p_category_id uuid default null,
  p_seller_id uuid default null,
  p_min_price integer default null,
  p_max_price integer default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_coins boolean := coalesce((public.coin_sales_settings() ->> 'enabled')::boolean, false);
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  with matched as (
    select p.*
    from public.marketplace_products p
    where p.status = 'approved'::public.marketplace_product_status
      and (p_material_type is null or p.material_type = p_material_type)
      and (p_category_id is null or p.category_id = p_category_id)
      and (p_seller_id is null or p.seller_id = p_seller_id)
      and (p_min_price is null or p.base_price >= p_min_price)
      and (p_max_price is null or p.base_price <= p_max_price)
      and (
        v_term is null
        -- Full text for whole words, trigram for the prefixes people type.
        or p.search_text @@ plainto_tsquery('simple', v_term)
        or p.title ilike '%' || v_term || '%'
      )
  )
  select count(*), coalesce(jsonb_agg(entry order by ord), '[]'::jsonb)
    into v_total, v_items
  from (
    select
      row_number() over (
        order by
          case when p_sort = 'popular' then m.sales_count end desc nulls last,
          case when p_sort = 'rating' then
            case when m.rating_count = 0 then 0 else m.rating_sum::numeric / m.rating_count end
          end desc nulls last,
          case when p_sort = 'price_asc' then m.base_price end asc nulls last,
          case when p_sort = 'price_desc' then m.base_price end desc nulls last,
          m.published_at desc nulls last,
          m.id
      ) as ord,
      jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'material_type', m.material_type,
        'material_label', (select t.label from public.marketplace_material_types t where t.code = m.material_type),
        'category_id', m.category_id,
        'base_price', m.base_price,
        'coin_price', case when v_coins then m.coin_price end,
        'currency', m.currency,
        'cover_path', m.cover_path,
        'content_units', m.content_units,
        'file_format', m.file_format,
        'has_study_guide', m.has_study_guide,
        'sales_count', m.sales_count,
        'rating', case when m.rating_count = 0 then null else round(m.rating_sum::numeric / m.rating_count, 2) end,
        'rating_count', m.rating_count,
        'seller_id', m.seller_id,
        'seller_name', (select coalesce(nullif(btrim(pr.full_name), ''), '—') from public.profiles pr where pr.id = m.seller_id),
        'published_at', m.published_at,
        'is_favorite', exists (
          select 1 from public.marketplace_favorites f
          where f.product_id = m.id and f.user_id = auth.uid()
        )
      ) as entry
    from matched m
  ) ranked
  where ord > v_offset and ord <= v_offset + v_limit;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    -- The quote travels with the list so a card can show the real payable
    -- amount without a second round trip per product.
    'commission', (select jsonb_build_object('buyer_fee_rate', c.buyer_fee_rate, 'seller_fee_rate', c.seller_fee_rate)
                   from public.commission_config c where c.scope = 'marketplace')
  );
end;
$$;

/**
 * What a seller has sold, is owed, and has been paid (see 202608100005) — and,
 * beside it, what they sold for J Tanga. Coin sales are already in the
 * seller's wallet, so they are reported apart from the so‘m payout figures.
 */
create or replace function public.seller_earnings_summary(p_seller_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_seller_id <> v_caller and not public.is_admin(v_caller) then
    raise exception 'only the seller may read these earnings' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'sales_count', (select count(*) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'gross_total', (select coalesce(sum(gross_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'fee_total', (select coalesce(sum(fee_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'net_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'pending_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                      where seller_id = p_seller_id and not is_sandbox
                        and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)),
    'paid_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                   where seller_id = p_seller_id and not is_sandbox and status = 'paid'::public.seller_ledger_status),
    'sandbox_sales', (select count(*) from public.seller_ledger_entries where seller_id = p_seller_id and is_sandbox),
    'coins', (
      select jsonb_build_object(
        'sales_count', count(*),
        'gross_total', coalesce(sum(price), 0),
        'fee_total', coalesce(sum(fee_amount), 0),
        'net_total', coalesce(sum(seller_net), 0),
        'last_sale_at', max(purchased_at)
      )
      from public.marketplace_coin_purchases where seller_id = p_seller_id
    ),
    'contact', (select jsonb_build_object('phone', c.phone, 'telegram_username', c.telegram_username)
                from public.seller_payout_contacts c where c.user_id = p_seller_id),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'period_start', s.period_start, 'period_end', s.period_end,
        'gross_sales', s.gross_sales, 'seller_fees', s.seller_fees, 'payable_amount', s.payable_amount,
        'currency', s.currency, 'status', s.status,
        'destination_note', s.destination_note, 'reference', s.reference,
        'paid_at', s.paid_at, 'created_at', s.created_at
      ) order by s.period_end desc)
      from public.seller_settlements s where s.seller_id = p_seller_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------- admin --
/** The coin side of the economy for the admin panel: both fees, coin sales and fee income. */
create or replace function public.admin_coin_economy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store jsonb := coalesce((select value from public.app_settings where key = 'marketplace.coin_sales'), '{}'::jsonb);
  v_transfer jsonb := coalesce((select value from public.app_settings where key = 'coins.transfer'), '{}'::jsonb);
  v_store_quote jsonb := public.coin_fee_quote('store', 0);
  v_transfer_quote jsonb := public.coin_fee_quote('transfer', 0);
  v_periods jsonb := '{}'::jsonb;
  v_period record;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_period in
    select * from (values
      ('today', date_trunc('day', now())),
      ('week', date_trunc('week', now())),
      ('month', date_trunc('month', now())),
      ('all_time', '-infinity'::timestamptz)
    ) as t(label, since)
  loop
    v_periods := v_periods || jsonb_build_object(v_period.label, jsonb_build_object(
      'sales_count', (select count(*) from public.marketplace_coin_purchases where purchased_at >= v_period.since),
      'sales_coins', (select coalesce(sum(price), 0) from public.marketplace_coin_purchases where purchased_at >= v_period.since),
      'store_fees', (select coalesce(sum(amount), 0) from public.coin_platform_fees where source = 'store_sale' and created_at >= v_period.since),
      'transfer_fees', (select coalesce(sum(amount), 0) from public.coin_platform_fees where source = 'transfer' and created_at >= v_period.since),
      'transfers_with_fee', (select count(*) from public.coin_platform_fees where source = 'transfer' and created_at >= v_period.since)
    ));
  end loop;

  return jsonb_build_object(
    'store', public.coin_sales_settings() || jsonb_build_object(
      'fee_percent', v_store_quote -> 'fee_percent', 'fee_min', v_store_quote -> 'fee_min'),
    'transfer', jsonb_build_object(
      'fee_percent', v_transfer_quote -> 'fee_percent', 'fee_min', v_transfer_quote -> 'fee_min',
      'min_amount', v_transfer -> 'min_amount', 'max_amount', v_transfer -> 'max_amount'),
    'periods', v_periods,
    'listed', (select count(*) from public.marketplace_products
                where coin_price is not null and status = 'approved'::public.marketplace_product_status),
    'recent_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'purchased_at', s.purchased_at, 'product_id', s.product_id, 'title', p.title,
        'buyer', coalesce(nullif(btrim(b.full_name), ''), b.username, '—'),
        'seller', coalesce(nullif(btrim(se.full_name), ''), se.username, '—'),
        'price', s.price, 'fee', s.fee_amount, 'seller_net', s.seller_net, 'fee_percent', s.fee_percent
      ) order by s.purchased_at desc)
      from (select * from public.marketplace_coin_purchases order by purchased_at desc limit 30) s
      join public.marketplace_products p on p.id = s.product_id
      left join public.profiles b on b.id = s.buyer_id
      left join public.profiles se on se.id = s.seller_id
    ), '[]'::jsonb),
    'raw', jsonb_build_object('store', v_store, 'transfer', v_transfer)
  );
end;
$$;

/**
 * Sets the two J Tanga fees, and whether the store sells for coins at all.
 *
 * Super admins only, like every other price in the coin economy: this decides
 * what every seller and every sender keeps. Merged into the existing settings
 * so the transfer bounds and the coin price range are left as they are, and
 * written to the audit log with the reason.
 */
create or replace function public.admin_set_coin_fees(
  p_store_enabled boolean,
  p_store_fee_percent numeric,
  p_store_fee_min integer,
  p_transfer_fee_percent numeric,
  p_transfer_fee_min integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_before_store public.app_settings%rowtype;
  v_before_transfer public.app_settings%rowtype;
  v_after_store public.app_settings%rowtype;
  v_after_transfer public.app_settings%rowtype;
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'reason is required' using errcode = '22023';
  end if;
  if p_store_fee_percent is null or p_transfer_fee_percent is null
     or p_store_fee_percent < 0 or p_store_fee_percent > 100
     or p_transfer_fee_percent < 0 or p_transfer_fee_percent > 100 then
    raise exception 'fee percent must be between 0 and 100' using errcode = '22023';
  end if;
  if p_store_fee_min is null or p_transfer_fee_min is null
     or p_store_fee_min < 0 or p_store_fee_min > 1000000
     or p_transfer_fee_min < 0 or p_transfer_fee_min > 1000000 then
    raise exception 'minimum fee must be between 0 and 1000000' using errcode = '22023';
  end if;

  select * into v_before_store from public.app_settings where key = 'marketplace.coin_sales' for update;
  select * into v_before_transfer from public.app_settings where key = 'coins.transfer' for update;
  if v_before_store.key is null or v_before_transfer.key is null then
    raise exception 'setting not found' using errcode = 'P0002';
  end if;

  update public.app_settings set
    value = value || jsonb_build_object(
      'enabled', coalesce(p_store_enabled, false),
      'fee_percent', round(p_store_fee_percent, 2),
      'fee_min', p_store_fee_min),
    updated_by = v_admin
  where key = 'marketplace.coin_sales'
  returning * into v_after_store;

  update public.app_settings set
    value = value || jsonb_build_object(
      'fee_percent', round(p_transfer_fee_percent, 2),
      'fee_min', p_transfer_fee_min),
    updated_by = v_admin
  where key = 'coins.transfer'
  returning * into v_after_transfer;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'economy.coin_fees', 'app_setting', 'marketplace.coin_sales,coins.transfer',
    jsonb_build_object('store', v_before_store.value, 'transfer', v_before_transfer.value),
    jsonb_build_object('store', v_after_store.value, 'transfer', v_after_transfer.value),
    v_reason
  );

  return jsonb_build_object('store', v_after_store.value, 'transfer', v_after_transfer.value);
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  -- Callable by a signed-in person; each checks who is asking itself.
  foreach v_signature in array array[
    'public.coin_sales_settings()',
    'public.coin_fee_quote(text, integer)',
    'public.marketplace_set_coin_price(uuid, integer)',
    'public.marketplace_coin_quote(uuid)',
    'public.marketplace_buy_with_coins(uuid, text, integer, boolean, text)',
    'public.admin_coin_economy()',
    'public.admin_set_coin_fees(boolean, numeric, integer, numeric, integer, text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;

revoke all on function public.marketplace_coin_price_guard() from public, anon, authenticated;
