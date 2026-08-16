-- Two things about buying on the marketplace.
--
-- First, a gap: `assert_marketplace_member('buy')` was added to
-- `marketplace_create_checkout`, but the app buys through
-- `order_create_marketplace` — so the button people actually press never asked
-- whether they had a plan. A gate on the door nobody uses is not a gate.
--
-- Second, the refund rule. A digital file cannot be handed back, so the sale is
-- final; somebody has to be told that before they pay, and their agreement has
-- to be the thing that lets the order open rather than a checkbox the client
-- could skip drawing.

/**
 * The wording, kept where an admin can change it.
 *
 * Legal text ages and is argued over, and every edit to it should not be a
 * deploy. `enabled` is here too: a market where refunds become mandatory is a
 * setting change, not a migration.
 */
insert into public.app_settings (key, value, description)
values (
  'marketplace.refund_policy',
  jsonb_build_object(
    'enabled', true,
    'title', 'PPTX mahsulotlari qaytarilmaydi',
    'body', 'Do‘kondagi mahsulotlar raqamli fayllardir. Xarid tasdiqlangach, fayl darhol hisobingizga o‘tadi va uni qaytarib berish texnik jihatdan mumkin emas. Shu sababli xariddan keyin to‘lov qaytarilmaydi. Mahsulot tavsifiga mos kelmasa yoki fayl ochilmasa — qo‘llab-quvvatlash xizmatiga murojaat qiling.',
    'checkbox_label', 'Bu raqamli mahsulot ekanligini va xariddan so‘ng qaytarib berilmasligini tushunaman.'
  ),
  'Marketplace refund policy: the wording shown before a purchase, and whether agreement is required.'
)
on conflict (key) do nothing;

/**
 * Is this order allowed to open without an acknowledgement?
 *
 * One place, so the two purchase paths cannot disagree about whether somebody
 * was asked. Returns the wording that was in force, which is what gets recorded
 * against the order: "they agreed" is worth little without "to what".
 */
create or replace function public.marketplace_refund_ack(p_acknowledged boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
begin
  select value into v_policy from public.app_settings where key = 'marketplace.refund_policy';
  v_policy := coalesce(v_policy, '{}'::jsonb);

  if coalesce((v_policy ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('required', false);
  end if;

  if coalesce(p_acknowledged, false) is not true then
    raise exception 'Xaridni tasdiqlash uchun qaytarish shartlariga rozilik bering.'
      using errcode = '42501', detail = 'refund_policy_not_accepted';
  end if;

  return jsonb_build_object(
    'required', true,
    'accepted_at', now(),
    -- The exact sentence they agreed to, not a version number that would need
    -- another table to resolve back into words.
    'accepted_text', v_policy ->> 'checkbox_label'
  );
end;
$$;

revoke all on function public.marketplace_refund_ack(boolean) from public, anon;
grant execute on function public.marketplace_refund_ack(boolean) to authenticated;

-- Dropped rather than replaced: a third argument with a default would create a
-- second overload, and PostgREST would pick between them by which keys a caller
-- happened to send. That mistake has been made once in this work already.
drop function if exists public.order_create_marketplace(uuid, text);

create or replace function public.order_create_marketplace(
  p_product_id uuid,
  p_platform text default null,
  p_refund_acknowledged boolean default false
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
  v_ack jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  -- Buying is member-only (§4). This is the path the app takes, so this is
  -- where the rule has to hold.
  perform public.assert_marketplace_member('buy');
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

  v_ack := public.marketplace_refund_ack(p_refund_acknowledged);

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
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))),
                       'refund_policy', v_ack)
  )
  returning * into v_order;
  perform public.order_mark_test(v_order.id);
  select * into v_order from public.orders where id = v_order.id;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

revoke all on function public.order_create_marketplace(uuid, text, boolean) from public, anon;
grant execute on function public.order_create_marketplace(uuid, text, boolean) to authenticated;

-- The other purchase path takes the same rule. Dropped and recreated for the
-- same reason as above: a defaulted extra argument is a new signature, and two
-- signatures is the thing being avoided.
drop function if exists public.marketplace_create_checkout(uuid, text, uuid, text);

create or replace function public.marketplace_create_checkout(
  p_product_id uuid,
  p_idempotency_key text,
  p_partial_card_id uuid default null,
  p_platform text default null,
  p_refund_acknowledged boolean default false
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
  perform public.assert_marketplace_member('buy');

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

  -- Asked before the money is quoted, so nobody sees a total they were never
  -- allowed to reach.
  perform public.marketplace_refund_ack(p_refund_acknowledged);

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

revoke all on function public.marketplace_create_checkout(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.marketplace_create_checkout(uuid, text, uuid, text, boolean) to authenticated;
