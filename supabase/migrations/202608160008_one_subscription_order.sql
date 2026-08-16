-- One way to buy a plan, not two.
--
-- `order_create_subscription(p_plan_code, ...)` already existed and the web
-- checkout already calls it. It read the plans out of
-- `app_settings.subscription.plans`, which was an empty placeholder — so the
-- page has been offering nothing this whole time.
--
-- Adding a second overload taking a plan id was the mistake this work has been
-- trying to avoid everywhere else: two doors to one thing, and PostgREST
-- choosing between them by which keys a caller happens to send. The id variant
-- is dropped and the original signature is kept, because the web already calls
-- it and a code is a better public identifier for a plan than a uuid. What
-- changes is where it looks: the table that now holds the plans.

drop function if exists public.order_create_subscription(uuid, text);

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

  v_existing := public.order_find_open(v_user, 'subscription', null, null, p_plan_code);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue,
    metadata
  ) values (
    -- No seller and no fees, so `platform_revenue` is what the fees add up to,
    -- which is nothing. That the platform keeps the money is said by there
    -- being no seller, not by inflating a column the arithmetic constraint
    -- governs.
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

revoke all on function public.order_create_subscription(text, text) from public, anon;
grant execute on function public.order_create_subscription(text, text) to authenticated;

-- The placeholder is retired rather than left to look authoritative: a settings
-- key that nothing reads is a trap for whoever edits it next expecting it to
-- change something.
update public.app_settings
   set value = jsonb_build_object('moved_to', 'public.subscription_plans'),
       description = 'Retired: plans live in the subscription_plans table (202608160001).'
 where key = 'subscription.plans';

-- The old publisher wrote the settings key that has just been retired, so it
-- now edits something nothing reads. Dropped rather than left as a second way
-- to publish a plan — `admin_save_subscription_plan` is the one door, and it
-- audits.
--
-- Its validations are not lost: a zero price, a zero duration, a code that is
-- not a code and a duplicated code are all refused by constraints on
-- `subscription_plans` itself, which is a better place for them than a function
-- somebody could route around.
drop function if exists public.admin_set_subscription_plans(jsonb);
