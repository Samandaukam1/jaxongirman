-- Two pieces of operator control the order engine was missing: a way to publish
-- a tariff, and a way to make a real payment against a small amount on purpose.

-- ------------------------------------------------------- subscription plans --
/**
 * Publishes the tariff catalogue.
 *
 * Plans live in `app_settings` rather than a table because there are a handful
 * of them, they change by decision rather than by volume, and the audited
 * settings path already gives us who-changed-what. Validation happens here so a
 * malformed plan cannot reach a checkout screen: a price of zero or a missing
 * duration would produce an order nobody could pay.
 */
create or replace function public.admin_set_subscription_plans(
  p_plans jsonb,
  p_currency text default 'UZS',
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
  v_plan jsonb;
  v_codes text[] := array[]::text[];
  v_code text;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' then
    raise exception 'plans must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_plans) > 20 then
    raise exception 'at most 20 plans' using errcode = '22023';
  end if;

  for v_plan in select value from jsonb_array_elements(p_plans) as value loop
    v_code := btrim(coalesce(v_plan ->> 'code', ''));
    if v_code !~ '^[a-z][a-z0-9_]{1,39}$' then
      raise exception 'Tarif kodi lotin harflari, raqam va pastki chiziqdan iborat bo‘lishi kerak: %', v_code
        using errcode = '22023';
    end if;
    if v_code = any(v_codes) then
      raise exception 'Tarif kodi takrorlangan: %', v_code using errcode = '22023';
    end if;
    v_codes := v_codes || v_code;

    if char_length(btrim(coalesce(v_plan ->> 'label', ''))) < 1 then
      raise exception 'Tarif nomi bo‘sh: %', v_code using errcode = '22023';
    end if;
    -- A plan a client could open but never pay is worse than no plan.
    if coalesce((v_plan ->> 'price_amount')::numeric, 0) <= 0 then
      raise exception 'Tarif narxi noldan katta bo‘lishi kerak: %', v_code using errcode = '22023';
    end if;
    if coalesce((v_plan ->> 'duration_months')::integer, 0) < 1 then
      raise exception 'Tarif muddati kamida 1 oy bo‘lishi kerak: %', v_code using errcode = '22023';
    end if;
  end loop;

  select coalesce(value, '{}'::jsonb) into v_before from public.app_settings where key = 'subscription.plans';
  v_after := jsonb_build_object(
    'currency', upper(coalesce(nullif(btrim(p_currency), ''), 'UZS')),
    'plans', p_plans
  );

  update public.app_settings set value = v_after, updated_at = now() where key = 'subscription.plans';
  if not found then
    insert into public.app_settings (key, value, description, public_read)
    values ('subscription.plans', v_after, 'Subscription tariffs offered for sale.', true);
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'subscription.plans.save', 'app_setting', 'subscription.plans',
          v_before, v_after, left(btrim(coalesce(p_reason, '')), 500));

  return v_after;
end;
$$;

-- ------------------------------------------------------------- test mode --
/**
 * Real payments, small amounts, named accounts.
 *
 * Payme has no Subscribe sandbox for this merchant, so the only way to verify
 * the live integration is to charge a real card. That is a legitimate need and a
 * dangerous one, so it is fenced three ways: it is off by default, it applies
 * only to accounts an admin has listed, and it caps what a test order may cost.
 *
 * What it deliberately does NOT do is change a published price. An ordinary
 * buyer must never see test pricing, so the catalogue is untouched — a test
 * order is simply refused if the real price exceeds the cap. Testing therefore
 * means publishing something genuinely cheap, not secretly discounting.
 */
insert into public.app_settings (key, value, description, public_read)
values (
  'payments.test_mode',
  jsonb_build_object(
    'enabled', false,
    -- Small enough that a mistake costs less than lunch.
    'max_amount', 1000,
    'user_ids', '[]'::jsonb
  ),
  'Production payment testing. Off by default. Only listed accounts may open a test order, and only up to max_amount. Never alters a published price.',
  false
)
on conflict (key) do nothing;

/** True when this account may open a test order for this amount. */
create or replace function public.payment_test_mode_for(p_user_id uuid, p_amount integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (value ->> 'enabled')::boolean
      and p_amount <= coalesce((value ->> 'max_amount')::integer, 0)
      and (value -> 'user_ids') @> to_jsonb(p_user_id::text)
    from public.app_settings where key = 'payments.test_mode'
  ), false);
$$;

create or replace function public.admin_set_payment_test_mode(
  p_enabled boolean,
  p_max_amount integer default null,
  p_emails text[] default null,
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
  v_ids jsonb;
begin
  if not public.is_super_admin(v_admin) then
    -- Deliberately stricter than the rest of the console: this switch authorises
    -- real charges against real cards.
    raise exception 'super admin role required' using errcode = '42501';
  end if;

  select coalesce(value, '{}'::jsonb) into v_before from public.app_settings where key = 'payments.test_mode';

  v_after := coalesce(v_before, '{}'::jsonb) || jsonb_build_object('enabled', coalesce(p_enabled, false));
  if p_max_amount is not null then
    if p_max_amount < 0 or p_max_amount > 50000 then
      raise exception 'Sinov summasi 0 dan 50 000 so‘m oralig‘ida bo‘lishi kerak.' using errcode = '22023';
    end if;
    v_after := jsonb_set(v_after, '{max_amount}', to_jsonb(p_max_amount));
  end if;

  if p_emails is not null then
    -- Emails in, ids out: an operator knows who somebody is, not their uuid.
    select coalesce(jsonb_agg(u.id::text), '[]'::jsonb) into v_ids
      from auth.users u
      where lower(u.email) = any (select lower(unnest(p_emails)));
    v_after := jsonb_set(v_after, '{user_ids}', v_ids);
  end if;

  update public.app_settings set value = v_after, updated_at = now() where key = 'payments.test_mode';
  if not found then
    insert into public.app_settings (key, value, description, public_read)
    values ('payments.test_mode', v_after, 'Production payment testing.', false);
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, case when p_enabled then 'payments.test_mode.on' else 'payments.test_mode.off' end,
          'app_setting', 'payments.test_mode', v_before, v_after,
          left(btrim(coalesce(p_reason, '')), 500));

  return v_after;
end;
$$;

/** What an operator sees: the switch, the cap, and who is listed — by email. */
create or replace function public.admin_payment_test_mode()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  select coalesce(value, '{}'::jsonb) into v_value from public.app_settings where key = 'payments.test_mode';
  return jsonb_build_object(
    'enabled', coalesce((v_value ->> 'enabled')::boolean, false),
    'max_amount', coalesce((v_value ->> 'max_amount')::integer, 0),
    'emails', coalesce((
      select jsonb_agg(u.email::text order by u.email)
      from auth.users u
      where (v_value -> 'user_ids') @> to_jsonb(u.id::text)
    ), '[]'::jsonb)
  );
end;
$$;

-- Every order creation path learns to mark a test order. `is_test` excludes it
-- from the finance totals while keeping it as a real row — a test charge moved
-- real money, and hiding it would make the books wrong.
create or replace function public.order_mark_test(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;
  if public.payment_test_mode_for(v_order.user_id, v_order.total_amount) then
    update public.orders set is_test = true where id = p_order_id;
  end if;
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_set_subscription_plans(jsonb, text, text)',
    'public.admin_set_payment_test_mode(boolean, integer, text[], text)',
    'public.admin_payment_test_mode()'
  ] loop
    execute format('revoke all on function %s from public, anon', v_signature);
    execute format('grant execute on function %s to authenticated, service_role', v_signature);
  end loop;

  foreach v_signature in array array[
    'public.payment_test_mode_for(uuid, integer)',
    'public.order_mark_test(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;

-- Each creation RPC now marks the order if the buyer is a listed test account.
-- Appended here rather than editing 012, which is already applied remotely.
do $$
declare
  v_name text;
  v_body text;
begin
  foreach v_name in array array[
    'order_create_jcoin', 'order_create_module', 'order_create_subscription', 'order_create_marketplace'
  ] loop
    select pg_get_functiondef(p.oid) into v_body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name;

    -- One insertion point, in the one place each function returns a fresh order.
    v_body := replace(
      v_body,
      'returning * into v_order;',
      'returning * into v_order;' || chr(10) ||
      '  perform public.order_mark_test(v_order.id);' || chr(10) ||
      '  select * into v_order from public.orders where id = v_order.id;'
    );
    execute v_body;
  end loop;
end
$$;
