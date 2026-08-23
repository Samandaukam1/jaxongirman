/**
 * An order that restarts rather than renews, and the settlement that knows the
 * difference.
 *
 * Both are the same purchase of the same plan at the same price. What separates
 * them is a flag the buyer sets when they ask: renew and the period is added to
 * what is left; restart and what is left is given up for a fresh cycle. The
 * flag rides on the order, so the decision is recorded with the money that paid
 * for it and cannot be changed between asking and settling.
 */

create or replace function public.order_create_subscription(
  p_plan_code text,
  p_platform text default null,
  p_restart boolean default false
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

  select * into v_plan from public.subscription_plans
   where code = p_plan_code and is_active;
  if not found then
    raise exception 'Bunday tarif sotuvda emas.' using errcode = 'P0002';
  end if;

  v_price := v_plan.price_amount;
  if v_price <= 0 then
    raise exception 'Tarif narxi belgilanmagan.' using errcode = '22023';
  end if;

  /**
   * An open order is reused only when it means the same thing.
   *
   * Reusing a renewal's unpaid order for a restart would take the money and
   * extend the tariff, which is the opposite of what was asked for — so a
   * request that disagrees with the open order starts its own.
   */
  v_existing := public.order_find_open(v_user, 'subscription', null, null, p_plan_code);
  if v_existing.id is not null then
    if coalesce((v_existing.metadata ->> 'restart')::boolean, false) = coalesce(p_restart, false) then
      return public.order_summary(v_existing) || jsonb_build_object('reused', true);
    end if;
    update public.orders set status = 'cancelled', metadata = metadata || jsonb_build_object('superseded', true)
     where id = v_existing.id;
  end if;

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    v_user, 'subscription', v_plan.code, v_plan.currency,
    v_price, 0, v_price, 0, v_price, 0,
    jsonb_build_object('plan_id', v_plan.id, 'label', v_plan.name,
                       'period_days', v_plan.period_days,
                       'restart', coalesce(p_restart, false),
                       'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  return public.order_summary(v_order);
end;
$$;

revoke all on function public.order_create_subscription(text, text, boolean) from public, anon;
grant execute on function public.order_create_subscription(text, text, boolean) to authenticated;
