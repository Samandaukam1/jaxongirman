-- Opening an order, for each of the four things Jaxongirman sells.
--
-- The rule every one of these enforces: the client sends an identifier and
-- nothing else. Not a price, not a fee, not a total. It sends a package code, a
-- plan code, a module code or a product id, and the server reads the amount from
-- the row that owns it and computes every figure. A request that carries a price
-- is not trusted differently — there is nowhere to put one.
--
-- `payment_transactions` gains an `order_id`, so the marketplace attempt log and
-- the new header describe the same purchase rather than competing to.

alter table public.payment_transactions
  add column order_id uuid references public.orders(id) on delete set null;

create index payment_transactions_order_idx on public.payment_transactions (order_id)
  where order_id is not null;

/**
 * The subject of a marketplace order, expressed as a purpose.
 *
 * A material type is a text code chosen by an admin; a purpose is a fixed enum.
 * Anything unrecognised lands on `other_marketplace_product`, so adding a
 * material type never breaks checkout — it just files the order under "other"
 * until this list learns about it.
 */
create or replace function public.order_purpose_for_material(p_material_type text)
returns public.order_purpose
language sql
immutable
set search_path = ''
as $$
  select case p_material_type
    when 'presentation' then 'marketplace_presentation'::public.order_purpose
    when 'essay' then 'marketplace_reference'::public.order_purpose
    when 'independent_work' then 'marketplace_independent_work'::public.order_purpose
    when 'game' then 'marketplace_game'::public.order_purpose
    else 'other_marketplace_product'::public.order_purpose
  end;
$$;

/**
 * Reuses an open order instead of opening a second one.
 *
 * The double-tap guard. A person who presses pay twice, or whose first request
 * timed out on the wire, gets the order they already have — same number, same
 * amount — rather than a duplicate to reconcile later.
 */
create or replace function public.order_find_open(
  p_user_id uuid,
  p_purpose public.order_purpose,
  p_product_id uuid default null,
  p_coin_package_id uuid default null,
  p_reference_code text default null
)
returns public.orders
language sql
stable
security definer
set search_path = ''
as $$
  select o.* from public.orders o
  where o.user_id = p_user_id
    and o.purpose = p_purpose
    and o.product_id is not distinct from p_product_id
    and o.coin_package_id is not distinct from p_coin_package_id
    and o.reference_code is not distinct from p_reference_code
    and o.status in ('pending'::public.order_status,
                     'awaiting_verification'::public.order_status,
                     'processing'::public.order_status)
    and o.expires_at > now()
  order by o.created_at desc
  limit 1;
$$;

/** The shape every creation RPC hands back. */
create or replace function public.order_summary(p_order public.orders)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', p_order.id,
    'order_number', p_order.order_number,
    'purpose', p_order.purpose,
    'status', p_order.status,
    'currency', p_order.currency,
    'subtotal', p_order.subtotal,
    'buyer_fee', p_order.buyer_fee,
    'buyer_fee_rate', p_order.buyer_fee_rate,
    'total_amount', p_order.total_amount,
    'is_test', p_order.is_test,
    'expires_at', p_order.expires_at
  );
$$;

-- ------------------------------------------------------------- J Coin --
/**
 * A coin package. The price comes from `coin_packages`, which only an admin
 * writes — so the amount charged is the amount published, and a client that
 * would like to pay less has no field to say so in.
 */
create or replace function public.order_create_jcoin(
  p_package_id uuid,
  p_platform text default null
)
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

  v_existing := public.order_find_open(v_user, 'jcoin', null, p_package_id, null);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  -- Whole som. The catalogue stores numeric so an admin can type 11000.50;
  -- what is charged is rounded once, here, and never recomputed.
  v_price := round(v_package.price_amount)::integer;

  insert into public.orders (
    user_id, purpose, coin_package_id, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    v_user, 'jcoin', p_package_id, v_package.currency,
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('coins', v_package.coins, 'bonus_coins', v_package.bonus_coins,
                       'package_code', v_package.code,
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

-- --------------------------------------------------- data collection module --
/**
 * Eleven months of module access. Price and duration come from
 * `app_settings.modules.<code>`, so neither is a literal in this function and
 * changing them is an audited admin edit.
 */
create or replace function public.order_create_module(
  p_module_code text default 'data_collection',
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_config jsonb;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_price integer;
  v_months integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_payment_allowed(p_platform, 'module');

  select value into v_config from public.app_settings where key = 'modules.' || p_module_code;
  if v_config is null then
    raise exception 'Bunday modul topilmadi.' using errcode = 'P0002';
  end if;
  if coalesce((v_config ->> 'enabled')::boolean, false) is not true then
    raise exception 'Bu modul hozircha sotuvda emas.' using errcode = '42501';
  end if;

  v_price := round(coalesce((v_config ->> 'price_amount')::numeric, 0))::integer;
  v_months := coalesce((v_config ->> 'duration_months')::integer, 11);
  if v_price <= 0 then
    raise exception 'Modul narxi belgilanmagan.' using errcode = '22023';
  end if;

  -- Already holds it: paying twice for an active window is not a purchase
  -- anybody meant to make.
  if public.has_module_access(p_module_code, v_user) then
    raise exception 'Bu modulga kirish huquqi allaqachon sizda bor.' using errcode = '22023';
  end if;

  v_existing := public.order_find_open(v_user, 'data_collection', null, null, p_module_code);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    v_user, 'data_collection', p_module_code, coalesce(v_config ->> 'currency', 'UZS'),
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('duration_months', v_months,
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

-- ----------------------------------------------------------- subscription --
/**
 * A tariff. Plans live in `app_settings.subscription.plans` as a list of
 * `{code, label, price_amount, duration_months}` so a new plan is an audited
 * admin edit rather than a migration.
 */
insert into public.app_settings (key, value, description, public_read)
values (
  'subscription.plans',
  jsonb_build_object('currency', 'UZS', 'plans', '[]'::jsonb),
  'Subscription tariffs offered for sale. Empty until an operator publishes one; nothing in the apps invents a plan.',
  true
)
on conflict (key) do nothing;

create or replace function public.order_create_subscription(
  p_plan_code text,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_config jsonb;
  v_plan jsonb;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_price integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_payment_allowed(p_platform, 'subscription');

  select value into v_config from public.app_settings where key = 'subscription.plans';
  select plan into v_plan
    from jsonb_array_elements(coalesce(v_config -> 'plans', '[]'::jsonb)) as plan
    where plan ->> 'code' = p_plan_code
      and coalesce((plan ->> 'is_active')::boolean, true)
    limit 1;
  if v_plan is null then
    raise exception 'Bunday tarif sotuvda emas.' using errcode = 'P0002';
  end if;

  v_price := round(coalesce((v_plan ->> 'price_amount')::numeric, 0))::integer;
  if v_price <= 0 then
    raise exception 'Tarif narxi belgilanmagan.' using errcode = '22023';
  end if;

  v_existing := public.order_find_open(v_user, 'subscription', null, null, p_plan_code);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    v_user, 'subscription', p_plan_code, coalesce(v_config ->> 'currency', 'UZS'),
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('duration_months', coalesce((v_plan ->> 'duration_months')::integer, 1),
                       'label', v_plan ->> 'label',
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

-- ------------------------------------------------------------ marketplace --
/**
 * A marketplace material. The only purpose that splits money, so the only one
 * that snapshots commission rates: `marketplace_quote()` is asked once, here,
 * and what it answered is written onto the order. A rate change tomorrow does
 * not rewrite this row.
 */
create or replace function public.order_create_marketplace(
  p_product_id uuid,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_quote jsonb;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_purpose public.order_purpose;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_payment_allowed(p_platform, 'marketplace');

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;
  if v_product.seller_id = v_user then
    raise exception 'O‘z mahsulotingizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if public.marketplace_has_entitlement(p_product_id, v_user) then
    raise exception 'Bu mahsulot allaqachon sizda bor.' using errcode = '22023';
  end if;

  v_purpose := public.order_purpose_for_material(v_product.material_type);

  v_existing := public.order_find_open(v_user, v_purpose, p_product_id, null, null);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  v_quote := public.marketplace_quote(v_product.base_price);

  insert into public.orders (
    user_id, purpose, product_id, seller_id, currency,
    subtotal, buyer_fee, total_amount,
    seller_fee, seller_net, platform_revenue,
    buyer_fee_rate, seller_fee_rate,
    metadata
  ) values (
    v_user, v_purpose, p_product_id, v_product.seller_id, coalesce(v_quote ->> 'currency', 'UZS'),
    (v_quote ->> 'base_price')::integer,
    (v_quote ->> 'buyer_fee_amount')::integer,
    (v_quote ->> 'buyer_total')::integer,
    (v_quote ->> 'seller_fee_amount')::integer,
    (v_quote ->> 'seller_net')::integer,
    (v_quote ->> 'platform_gross')::integer,
    (v_quote ->> 'buyer_fee_rate')::numeric,
    (v_quote ->> 'seller_fee_rate')::numeric,
    jsonb_build_object('material_type', v_product.material_type,
                       'title', v_product.title,
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

/** A person's own receipts, for the payment history screen. No card data. */
create or replace function public.my_orders(p_limit integer default 50)
returns table (
  order_number text,
  purpose public.order_purpose,
  status public.order_status,
  total_amount integer,
  currency text,
  title text,
  created_at timestamptz,
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.order_number, o.purpose, o.status, o.total_amount, o.currency,
         coalesce(o.metadata ->> 'title', o.metadata ->> 'label', o.reference_code, ''),
         o.created_at, o.paid_at
  from public.orders o
  where o.user_id = auth.uid()
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.order_create_jcoin(uuid, text)',
    'public.order_create_module(text, text)',
    'public.order_create_subscription(text, text)',
    'public.order_create_marketplace(uuid, text)',
    'public.my_orders(integer)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  -- Internal: only the creation functions above call these.
  foreach v_signature in array array[
    'public.order_find_open(uuid, public.order_purpose, uuid, uuid, text)',
    'public.order_summary(public.orders)',
    'public.order_purpose_for_material(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
