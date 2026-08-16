-- Selling the subscription.
--
-- The order machinery already anticipated this: `order_purpose` has had a
-- `subscription` value all along, and `order_fulfil` already had a branch for
-- it. That branch wrote a `module_entitlements` row keyed `plan:<code>` which
-- nothing ever read — the readers of that table serve modules — so it is
-- replaced here rather than kept beside the real membership. Keeping both would
-- have been exactly the second-thing-to-keep-correct its own comment warned of.
--
-- Payme is untouched. A subscription is an order like any other, so it goes
-- through the same card flow, the same partial-card hints and the same
-- reconciliation as a J Coin purchase.

/**
 * Opens an order for a plan, priced by the server.
 *
 * The client names a plan and nothing else. A price that arrived in the request
 * would be a price the buyer chose, so the amount comes from
 * `subscription_plans` and the plan's own currency comes with it.
 *
 * An open order for the same plan is reused rather than duplicated, the way
 * `order_create_jcoin` already does: two presses are one purchase.
 */
create or replace function public.order_create_subscription(
  p_plan_id uuid,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.subscription_plans%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_price integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_payment_allowed(p_platform, 'subscription');
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id and is_active;
  if not found then
    raise exception 'Bu tarif sotuvda emas.' using errcode = 'P0002';
  end if;

  v_existing := public.order_find_open(v_user, 'subscription', null, null, v_plan.code);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  v_price := v_plan.price_amount;

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    -- No seller and no fees, so the arithmetic is the same shape a J Coin
    -- order uses: `platform_revenue` is what the fees add up to, which is
    -- nothing. That the platform keeps the money is said by there being no
    -- seller, not by inflating a revenue column the constraint governs.
    v_user, 'subscription', v_plan.code, v_plan.currency,
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('plan_id', v_plan.id, 'label', v_plan.name,
                       'period_days', v_plan.period_days,
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order) || jsonb_build_object('reused', false);
end;
$$;

revoke all on function public.order_create_subscription(uuid, text) from public, anon;
grant execute on function public.order_create_subscription(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.order_fulfil(p_order_id uuid, p_payme_receipt_id text DEFAULT NULL::text, p_payme_transaction_id text DEFAULT NULL::text, p_provider_cost integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_advanced boolean;
  v_wallet public.credit_wallets%rowtype;
  v_coins integer;
  v_months integer;
  v_entitlement public.module_entitlements%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_subscription public.user_subscriptions%rowtype;
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
      /**
       * A membership, written where memberships live.
       *
       * This used to write a `module_entitlements` row keyed `plan:<code>`, on
       * the reasoning that a separate table would be a second thing to keep
       * correct. Nothing ever read those rows — the readers of that table are
       * `has_module_access` and `module_access_state`, which serve modules — so
       * it was a write with no reader, and now there is a real membership to
       * write instead. Keeping both would have been the second thing to keep
       * correct that the original comment was worried about.
       */
      select * into v_plan from public.subscription_plans
        where code = v_order.reference_code;
      if not found then
        raise exception 'subscription plan not found: %', v_order.reference_code using errcode = 'P0002';
      end if;

      select * into v_subscription from public.user_subscriptions
        where user_id = v_order.user_id
          and status in ('active'::public.subscription_status, 'payment_pending'::public.subscription_status)
        for update;

      if found then
        -- A renewal extends from whichever is later: time already paid for is
        -- not forfeited by renewing early, and a lapsed membership starts now
        -- rather than backdating into the gap.
        update public.user_subscriptions set
          plan_id = v_plan.id,
          status = 'active',
          order_id = v_order.id,
          started_at = coalesce(started_at, now()),
          expires_at = greatest(coalesce(expires_at, now()), now())
            + make_interval(days => v_plan.period_days),
          cancelled_at = null,
          plan_snapshot = jsonb_build_object('features', v_plan.features, 'price_amount', v_plan.price_amount)
          where id = v_subscription.id
          returning * into v_subscription;
      else
        insert into public.user_subscriptions (
          user_id, plan_id, status, order_id, started_at, expires_at, plan_snapshot
        ) values (
          v_order.user_id, v_plan.id, 'active', v_order.id, now(),
          now() + make_interval(days => v_plan.period_days),
          jsonb_build_object('features', v_plan.features, 'price_amount', v_plan.price_amount)
        )
        returning * into v_subscription;
      end if;

      v_result := jsonb_build_object(
        'plan', v_plan.code, 'expires_at', v_subscription.expires_at,
        'subscription_id', v_subscription.id);

      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_order.user_id, 'order_paid', 'Tarif faollashtirildi',
        coalesce(v_order.metadata ->> 'label', v_order.reference_code)
          || ' — buyurtma ' || v_order.order_number,
        jsonb_build_object('order_number', v_order.order_number, 'plan', v_order.reference_code),
        '/(app)/(tabs)/profile'
      );

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
$function$;
