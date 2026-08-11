-- Fulfilment: what a paid order gives you.
--
-- The rule this file exists to enforce: a client saying "payment successful" is
-- not evidence. Nothing here runs until the server has been told by the provider
-- that a receipt is paid, and everything here runs in one transaction — the
-- order flips, the entitlement appears, the ledgers move and the notification is
-- written, or none of it does.
--
-- Called exactly once per order, and safe to call again. `order_advance` returns
-- false for a repeat, and every write below is keyed so a second run adds
-- nothing: this is what makes a retried provider callback harmless.

/**
 * Grants what the order bought, then marks it paid.
 *
 * Service-role only. There is no path from a client to this function, because a
 * client cannot know that a payment happened — only the code holding the
 * provider's answer can.
 *
 * `p_provider_cost` is what the provider charged us, in whole som, so the
 * marketplace transaction's own accounting stays truthful.
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
  v_months integer;
  v_entitlement public.module_entitlements%rowtype;
  v_transaction public.payment_transactions%rowtype;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- Already fulfilled. Returning rather than raising is deliberate: a retried
  -- callback is a normal event, not an error to page somebody about.
  if v_order.status = 'paid'::public.order_status then
    return jsonb_build_object('order_number', v_order.order_number, 'already', true);
  end if;

  -- Provider identifiers first, so a crash between here and the commit leaves a
  -- row that reconciliation can match to a receipt.
  update public.orders set
    payme_receipt_id = coalesce(p_payme_receipt_id, payme_receipt_id),
    payme_transaction_id = coalesce(p_payme_transaction_id, payme_transaction_id)
    where id = p_order_id;

  -- Nothing reaches `paid` without having been `processing`, and that is not a
  -- formality: `processing` is the state a recovery sweep looks for, so an order
  -- that skipped it would be invisible to reconciliation if the commit failed
  -- halfway. By the time this function is called the provider has been asked to
  -- charge, which makes `processing` factually true — so walk through it rather
  -- than making every caller remember to.
  if v_order.status in ('pending'::public.order_status, 'awaiting_verification'::public.order_status) then
    perform public.order_advance(p_order_id, 'processing'::public.order_status);
  end if;

  v_advanced := public.order_advance(p_order_id, 'paid'::public.order_status);
  if not v_advanced then
    return jsonb_build_object('order_number', v_order.order_number, 'already', true);
  end if;
  select * into v_order from public.orders where id = p_order_id;

  case v_order.purpose
    -- ------------------------------------------------------------- J Coin --
    when 'jcoin' then
      v_coins := coalesce((v_order.metadata ->> 'coins')::integer, 0)
               + coalesce((v_order.metadata ->> 'bonus_coins')::integer, 0);
      if v_coins <= 0 then
        raise exception 'order % has no coins to grant', v_order.order_number using errcode = 'P0001';
      end if;

      select * into v_wallet from public.credit_wallets where user_id = v_order.user_id for update;
      if not found then
        raise exception 'credit wallet not found' using errcode = 'P0002';
      end if;

      -- The ledger row is written first and carries the order number as its
      -- idempotency key, so a second run conflicts and grants nothing. The
      -- wallet is never incremented directly by anything but this pairing.
      insert into public.credit_transactions (
        user_id, type, amount, reservation_delta, balance_after, reserved_after,
        idempotency_key, description, metadata
      ) values (
        v_order.user_id, 'coin_purchase', v_coins, 0,
        v_wallet.balance + v_coins, v_wallet.reserved,
        'order:' || v_order.order_number, 'J Coin xaridi',
        jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                           'amount_paid', v_order.total_amount)
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

    -- --------------------------------------------------- module access --
    when 'data_collection' then
      v_months := coalesce((v_order.metadata ->> 'duration_months')::integer, 11);

      -- One active entitlement per person per module: a second purchase extends
      -- rather than stacking, which is what the existing access check expects.
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
      -- Subscriptions are recorded as module entitlements keyed by plan code:
      -- the same shape, the same expiry arithmetic, the same access check. A
      -- separate table would be a second thing to keep correct.
      v_months := coalesce((v_order.metadata ->> 'duration_months')::integer, 1);

      select * into v_entitlement from public.module_entitlements
        where user_id = v_order.user_id and module_code = 'plan:' || v_order.reference_code
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
          v_order.user_id, 'plan:' || v_order.reference_code, 'active', now(),
          now() + make_interval(months => v_months),
          v_order.total_amount, v_order.currency, 'purchase', v_order.order_number,
          jsonb_build_object('order_id', v_order.id, 'plan', v_order.reference_code)
        );
      end if;

      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_order.user_id, 'order_paid', 'Tarif faollashtirildi',
        coalesce(v_order.metadata ->> 'label', v_order.reference_code)
          || ' — buyurtma ' || v_order.order_number,
        jsonb_build_object('order_number', v_order.order_number, 'plan', v_order.reference_code),
        '/(app)/(tabs)/profile'
      );
      v_result := jsonb_build_object('plan', v_order.reference_code, 'months', v_months);

    -- ------------------------------------------------------ marketplace --
    else
      -- The marketplace already has settlement worth reusing: it writes the
      -- purchase, the entitlement, the seller ledger and both notifications in
      -- one transaction. What it needs is a transaction row to settle, so the
      -- order supplies one and then hands over.
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

      -- Idempotent by the purchase's own unique (buyer_id, product_id): if the
      -- row is already there, settlement has run and running it again would
      -- raise rather than double-grant. Existence is the whole question.
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

/**
 * Records a failure against an order without pretending to know more than the
 * provider said. Nothing is granted, nothing is reversed — there was never
 * anything to reverse.
 */
create or replace function public.order_fail(
  p_order_id uuid,
  p_code text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.order_advance(p_order_id, 'failed'::public.order_status, p_code, p_message);
end;
$$;

-- ------------------------------------------------------------------ grants --
-- Fulfilment is not a client capability. Only the server code that holds the
-- provider's answer may reach these.
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.order_fulfil(uuid, text, text, integer)',
    'public.order_fail(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
