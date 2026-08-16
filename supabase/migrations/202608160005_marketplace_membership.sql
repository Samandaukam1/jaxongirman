-- The marketplace becomes a members' economy.
--
-- Browsing stays open to everyone: a shop nobody may look into has nothing to
-- sell a subscription with. Buying and selling do not, and the refusal happens
-- in the database rather than by hiding a button — a hidden button is a
-- suggestion, and `marketplace_create_checkout` is reachable directly.
--
-- The two guards are one line each, inserted into the functions exactly as they
-- stand. Rewriting a long function from memory silently dropped five things
-- from `fail_generation` earlier in this work; these were edited by fetching the
-- live definition and adding a line to it.

/**
 * Refuses anyone without a live membership, in the plan's own words.
 *
 * A plan may say otherwise — `marketplace_buy` and `marketplace_sell` are
 * features an admin can turn off — so this asks the entitlements rather than
 * assuming every member may do everything.
 */
create or replace function public.assert_marketplace_member(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ent jsonb;
  v_feature text := case lower(coalesce(p_action, '')) when 'sell' then 'marketplace_sell' else 'marketplace_buy' end;
begin
  v_ent := public.my_entitlements(auth.uid());

  if coalesce((v_ent ->> 'member')::boolean, false) is not true then
    raise exception 'Do‘kondan foydalanish uchun tarifni faollashtiring.'
      using errcode = '42501', detail = 'subscription_required';
  end if;

  if coalesce((v_ent -> 'features' -> 'marketplace_access' ->> 'enabled')::boolean, false) is not true
     or coalesce((v_ent -> 'features' -> v_feature ->> 'enabled')::boolean, false) is not true then
    raise exception 'Tarifingizda bu amal mavjud emas.'
      using errcode = '42501', detail = 'not_entitled';
  end if;
end;
$$;

revoke all on function public.assert_marketplace_member(text) from public, anon;
grant execute on function public.assert_marketplace_member(text) to authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_create_checkout(p_product_id uuid, p_idempotency_key text, p_partial_card_id uuid DEFAULT NULL::uuid, p_platform text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_save_product(p_product_id uuid, p_material_type text, p_title text, p_description text DEFAULT ''::text, p_base_price integer DEFAULT 0, p_category_id uuid DEFAULT NULL::uuid, p_cover_path text DEFAULT NULL::text, p_content_units integer DEFAULT NULL::integer, p_file_format text DEFAULT NULL::text, p_submit boolean DEFAULT false, p_game_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seller uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_game public.games%rowtype;
  v_status public.marketplace_product_status;
  v_game_id uuid := p_game_id;
  v_content_units integer := p_content_units;
begin
  if v_seller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_marketplace_member('sell');

  if not exists (select 1 from public.marketplace_material_types where code = p_material_type and is_active) then
    raise exception 'material type is unavailable' using errcode = '22023';
  end if;
  if p_base_price is null or p_base_price < 0 then
    raise exception 'price must not be negative' using errcode = '22023';
  end if;

  -- A game listing must point at a hostable game the seller owns; anything
  -- else must not point at a game at all. The check constraint would catch
  -- both, but these messages name the actual problem.
  if p_material_type = 'game' then
    if v_game_id is null then
      raise exception 'O‘yin tanlanmagan.' using errcode = '22023';
    end if;
    select * into v_game from public.games where id = v_game_id;
    if not found or v_game.owner_id <> v_seller then
      raise exception 'O‘yin topilmadi yoki sizga tegishli emas.' using errcode = '42501';
    end if;
    if v_game.status <> 'ready'::public.game_status then
      raise exception 'Avval o‘yinni tayyor holatga keltiring.' using errcode = '22023';
    end if;
    v_content_units := v_game.question_count;
  else
    v_game_id := null;
  end if;

  v_status := case when p_submit
    then 'pending_review'::public.marketplace_product_status
    else 'draft'::public.marketplace_product_status end;

  if p_product_id is null then
    insert into public.marketplace_products (
      seller_id, material_type, category_id, title, description, status,
      base_price, cover_path, content_units, file_format, game_id
    ) values (
      v_seller, p_material_type, p_category_id, btrim(p_title), left(btrim(coalesce(p_description, '')), 4000),
      v_status, p_base_price, p_cover_path, v_content_units, p_file_format, v_game_id
    )
    returning * into v_product;
  else
    select * into v_product from public.marketplace_products where id = p_product_id for update;
    if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
    if v_product.seller_id <> v_seller then
      raise exception 'only the seller may edit this product' using errcode = '42501';
    end if;

    update public.marketplace_products set
      material_type = p_material_type,
      category_id = p_category_id,
      title = btrim(p_title),
      description = left(btrim(coalesce(p_description, '')), 4000),
      base_price = p_base_price,
      cover_path = p_cover_path,
      content_units = v_content_units,
      file_format = p_file_format,
      game_id = v_game_id,
      status = case
        when p_submit and v_product.status in (
          'draft'::public.marketplace_product_status, 'rejected'::public.marketplace_product_status
        ) then 'pending_review'::public.marketplace_product_status
        else v_product.status
      end,
      rejection_reason = case when p_submit then null else v_product.rejection_reason end
      where id = v_product.id
      returning * into v_product;
  end if;

  return v_product.id;
end;
$function$;


/**
 * Opening a paid item on the weekly allowance rather than by buying it.
 *
 * What a member gets is the right to use the work inside Jaxongirman: edit it,
 * present it. What they do not get is the file or the right to sell it on —
 * they did not buy it, and the seller is still its author. Those are columns on
 * the licence, checked by whatever wants to export, not buttons left out of a
 * screen.
 *
 * The allowance is spent before the licence is written and given back if the
 * copy fails, so a crash cannot cost somebody their week.
 */
create or replace function public.marketplace_unlock_with_subscription(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_existing public.marketplace_licenses%rowtype;
  v_quota jsonb;
  v_license public.marketplace_licenses%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_marketplace_member('buy');

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;
  if v_product.seller_id = v_user then
    raise exception 'O‘z mahsulotingizni ochishning hojati yo‘q.' using errcode = '22023';
  end if;

  -- Already open, on this allowance or by having bought it: nothing to spend.
  select * into v_existing from public.marketplace_licenses
   where user_id = v_user and product_id = p_product_id;
  if found then
    return jsonb_build_object('ok', true, 'repeated', true, 'license_id', v_existing.id,
      'license_type', v_existing.license_type, 'download_allowed', v_existing.download_allowed);
  end if;
  if public.marketplace_has_entitlement(p_product_id, v_user) then
    return jsonb_build_object('ok', true, 'repeated', true, 'license_type', 'purchase',
      'download_allowed', true);
  end if;

  v_quota := public.quota_consume('marathon_unlock', 1, v_user);
  if coalesce((v_quota ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', coalesce(v_quota ->> 'code', 'quota_exhausted'),
      'limit', v_quota -> 'limit', 'used', v_quota -> 'used', 'resets_at', v_quota -> 'resets_at');
  end if;

  insert into public.marketplace_licenses (
    user_id, product_id, license_type, source_type,
    editable, presentable, download_allowed, resale_allowed
  ) values (
    v_user, p_product_id, 'subscription_access', 'marketplace',
    true, true, false, false
  )
  returning * into v_license;

  return jsonb_build_object('ok', true, 'repeated', false, 'license_id', v_license.id,
    'license_type', v_license.license_type, 'editable', true, 'presentable', true,
    'download_allowed', false, 'resale_allowed', false,
    'remaining', v_quota -> 'remaining', 'resets_at', v_quota -> 'resets_at');
end;
$$;

revoke all on function public.marketplace_unlock_with_subscription(uuid) from public, anon;
grant execute on function public.marketplace_unlock_with_subscription(uuid) to authenticated;

/**
 * May this person take the file away?
 *
 * A purchase says yes; an unlock says no. Asked by every export path, so the
 * answer does not depend on which screen the request came from.
 */
create or replace function public.marketplace_may_download(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select l.download_allowed from public.marketplace_licenses l
      where l.user_id = p_user_id and l.product_id = p_product_id),
    public.marketplace_has_entitlement(p_product_id, p_user_id)
  );
$$;

revoke all on function public.marketplace_may_download(uuid, uuid) from public, anon;
grant execute on function public.marketplace_may_download(uuid, uuid) to authenticated, service_role;
