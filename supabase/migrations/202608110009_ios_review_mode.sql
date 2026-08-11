-- iOS payment policy: one switch, enforced on the server.
--
-- Why this exists, stated plainly so nobody later mistakes it for a trick.
--
-- App Store Review Guideline 3.1.1 requires that anything unlocking features or
-- content inside an iOS app be sold through in-app purchase. Jaxongirman sells
-- subscriptions, J Coin, module access and digital marketplace goods — all of
-- which are consumed in the app — so an external card charge for any of them is
-- not permitted on iOS. Until StoreKit is implemented, the compliant iOS build
-- is one that does not offer those purchases at all.
--
-- That is what this flag configures. It is deliberately NOT a review-time
-- disguise: 2.3.1(a) forbids "hidden, dormant, or undocumented features", and an
-- app that behaves one way for App Review and another way afterwards is grounds
-- for removal and, under 2.3.1(b), for termination of the developer account.
-- Whatever this flag is set to during review is what it must stay set to.
--
-- Two further properties matter:
--
--   * It is server-enforced, not a client-side hide. A build that forgot to
--     check, or a request replayed from a script, is refused by the RPC that
--     would have opened the payment.
--   * It never applies to Android or web. Those platforms have no such rule,
--     and the check is written so that an unknown or absent platform is treated
--     as "not iOS" — the switch can only ever narrow iOS.

insert into public.app_settings (key, value, description, public_read)
values (
  'payments.ios_policy',
  jsonb_build_object(
    'review_mode', false,
    -- Copy shown where a purchase would have been. Default deliberately names
    -- no other way to buy: 3.1.1(a) forbids calls to action pointing at
    -- non-IAP purchasing mechanisms in every storefront except the United
    -- States, and Jaxongirman ships to Uzbekistan. The steering variants are
    -- available to an operator who has an entitlement or a US storefront, and
    -- the admin console warns before they are chosen.
    'copy', jsonb_build_object(
      'subscription', 'Tarif iOS ilovasida mavjud emas.',
      'jcoin', 'J Coin iOS ilovasida mavjud emas.',
      'marketplace', 'Do‘kon iOS ilovasida vaqtincha mavjud emas.',
      'module', 'Bu modul iOS ilovasida mavjud emas.'
    )
  ),
  'iOS payment policy. While review_mode is on, the iOS app offers no external purchases and the server refuses to open one for an iOS client. Android and web are never affected.',
  -- Clients must be able to read it before they render a price, so it is public.
  -- It contains no secret: it is a boolean and four sentences.
  true
)
on conflict (key) do nothing;

/**
 * Whether an external payment may be opened for a client on this platform.
 *
 * The platform is whatever the client says it is, and that is on purpose: this
 * is a store-compliance switch, not a security boundary. Somebody who lies
 * about their platform to reach a payment form ends up paying us money, which
 * is not a threat model. What matters is that the real iOS build reports `ios`
 * and is refused, so the behaviour App Review sees is the behaviour every iOS
 * user gets.
 *
 * Anything that is not exactly 'ios' — android, web, null, a typo — is allowed,
 * so a missing header can never take payments away from Android.
 */
create or replace function public.payments_blocked_for_platform(p_platform text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Trimmed as well as lowercased: a stray space in a header must not be able
  -- to buy an iOS client a payment form it is not allowed to have.
  select lower(btrim(coalesce(p_platform, ''))) = 'ios'
    and coalesce(
      (select (value -> 'review_mode')::boolean from public.app_settings where key = 'payments.ios_policy'),
      false
    );
$$;

/** The refusal, in one place, so every payment entry point says the same thing. */
create or replace function public.assert_payment_allowed(p_platform text default null, p_context text default 'marketplace')
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_copy jsonb;
begin
  if not public.payments_blocked_for_platform(p_platform) then
    return;
  end if;
  select value -> 'copy' into v_copy from public.app_settings where key = 'payments.ios_policy';
  raise exception '%', coalesce(v_copy ->> p_context, 'Bu amal iOS ilovasida mavjud emas.')
    using errcode = '42501', hint = 'ios_payments_disabled';
end;
$$;

/**
 * What a client may show, in one round trip, before it renders any price.
 *
 * Clients call this with their own platform and get back a decision rather than
 * a raw setting, so no screen has to reimplement "is this iOS, and is the flag
 * on, and is a provider configured".
 */
create or replace function public.payment_policy(p_platform text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_payments jsonb;
  v_blocked boolean := public.payments_blocked_for_platform(p_platform);
begin
  select coalesce(value, '{}'::jsonb) into v_policy from public.app_settings where key = 'payments.ios_policy';
  select coalesce(value, '{}'::jsonb) into v_payments from public.app_settings where key = 'payments.config';

  return jsonb_build_object(
    'payments_enabled', not v_blocked,
    'provider_configured', coalesce((v_payments ->> 'configured')::boolean, false),
    'provider', v_payments ->> 'provider',
    -- Prices are hidden alongside the buttons: a price with no way to pay it is
    -- an advertisement for a purchase the app cannot make.
    'show_prices', not v_blocked,
    'copy', coalesce(v_policy -> 'copy', '{}'::jsonb)
  );
end;
$$;

/**
 * The admin switch. Audited, because "who turned this on and when" is the first
 * question anybody asks when an iOS build behaves differently from Android.
 */
create or replace function public.admin_set_ios_payment_policy(
  p_review_mode boolean,
  p_copy jsonb default null,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_review_mode is null then
    raise exception 'review_mode is required' using errcode = '22023';
  end if;

  select coalesce(value, '{}'::jsonb) into v_before from public.app_settings where key = 'payments.ios_policy';

  v_after := jsonb_set(
    coalesce(v_before, '{}'::jsonb),
    '{review_mode}',
    to_jsonb(p_review_mode)
  );
  if p_copy is not null then
    if jsonb_typeof(p_copy) <> 'object' then
      raise exception 'copy must be an object' using errcode = '22023';
    end if;
    v_after := jsonb_set(v_after, '{copy}', coalesce(v_before -> 'copy', '{}'::jsonb) || p_copy);
  end if;

  update public.app_settings set value = v_after, updated_at = now()
    where key = 'payments.ios_policy';
  if not found then
    insert into public.app_settings (key, value, description, public_read)
    values ('payments.ios_policy', v_after, 'iOS payment policy.', true);
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin,
    case when p_review_mode then 'payments.ios_review_mode.on' else 'payments.ios_review_mode.off' end,
    'app_setting', 'payments.ios_policy', v_before, v_after,
    left(btrim(coalesce(p_reason, '')), 500)
  );

  return v_after;
end;
$$;

-- ------------------------------------------------------- enforcement points --
/**
 * Marketplace checkout learns the caller's platform.
 *
 * Added with a default so every existing caller keeps working; an iOS client
 * that passes 'ios' while the mode is on is refused before a transaction row
 * exists, which is the point — no order, no provider call, nothing to reconcile.
 */
create or replace function public.marketplace_create_checkout(
  p_product_id uuid,
  p_idempotency_key text,
  p_partial_card_id uuid default null,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_quote jsonb;
  v_existing public.payment_transactions%rowtype;
  v_transaction public.payment_transactions%rowtype;
  v_key text;
begin
  if v_buyer is null then raise exception 'authentication required' using errcode = '28000'; end if;

  -- Before anything else: this platform may not open an external payment.
  perform public.assert_payment_allowed(p_platform, 'marketplace');

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;
  if v_product.seller_id = v_buyer then
    raise exception 'O‘z mahsulotingizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if public.marketplace_has_entitlement(p_product_id, v_buyer) then
    raise exception 'Bu mahsulot allaqachon sizda bor.' using errcode = '22023';
  end if;

  select * into v_existing from public.payment_transactions
    where buyer_id = v_buyer and idempotency_key = v_key;
  if found then
    return jsonb_build_object('transaction_id', v_existing.id, 'state', v_existing.state, 'reused', true,
      'buyer_total', v_existing.buyer_total, 'base_price', v_existing.base_price,
      'buyer_fee_amount', v_existing.buyer_fee_amount, 'currency', v_existing.currency);
  end if;

  v_quote := public.marketplace_quote(v_product.base_price);

  insert into public.payment_transactions (
    buyer_id, product_id, seller_id, base_price, currency,
    buyer_fee_rate, buyer_fee_amount, buyer_total,
    seller_fee_rate, seller_fee_amount, seller_net, platform_gross,
    partial_card_id, idempotency_key
  ) values (
    v_buyer, p_product_id, v_product.seller_id,
    (v_quote ->> 'base_price')::integer, coalesce(v_quote ->> 'currency', 'UZS'),
    (v_quote ->> 'buyer_fee_rate')::numeric, (v_quote ->> 'buyer_fee_amount')::integer,
    (v_quote ->> 'buyer_total')::integer,
    (v_quote ->> 'seller_fee_rate')::numeric, (v_quote ->> 'seller_fee_amount')::integer,
    (v_quote ->> 'seller_net')::integer, (v_quote ->> 'platform_gross')::integer,
    p_partial_card_id, v_key
  )
  returning * into v_transaction;

  -- Same event the original wrote, plus the platform that opened it: when an
  -- iOS build is meant to be refused, "which platform was this?" is the first
  -- question a disputed row raises.
  insert into public.payment_audit_events (transaction_id, event, state_to, message, metadata)
  values (
    v_transaction.id, 'checkout.created', v_transaction.state, 'Checkout opened',
    jsonb_build_object('platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  );

  return jsonb_build_object(
    'transaction_id', v_transaction.id, 'state', v_transaction.state, 'reused', false,
    'buyer_total', v_transaction.buyer_total, 'base_price', v_transaction.base_price,
    'buyer_fee_amount', v_transaction.buyer_fee_amount, 'currency', v_transaction.currency
  );
end;
$$;

-- The old three-argument signature would still be resolvable by name and would
-- bypass the platform check, so it goes.
drop function if exists public.marketplace_create_checkout(uuid, text, uuid);

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.payment_policy(text)',
    'public.marketplace_create_checkout(uuid, text, uuid, text)',
    'public.admin_set_ios_payment_policy(boolean, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  -- Internal guards: reachable only from the definer functions above.
  execute 'revoke all on function public.payments_blocked_for_platform(text) from public, anon, authenticated';
  execute 'revoke all on function public.assert_payment_allowed(text, text) from public, anon, authenticated';
  execute 'grant execute on function public.payments_blocked_for_platform(text) to service_role';
  execute 'grant execute on function public.assert_payment_allowed(text, text) to service_role';
end
$$;
