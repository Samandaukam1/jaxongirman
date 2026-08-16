-- Shaping a plan from the console.
--
-- One door, audited, with the price and the capabilities arriving together —
-- a plan whose features could be edited separately from its price is a plan
-- that can be made to promise more than it charges for without anyone noticing.

/**
 * Creates or updates a plan.
 *
 * Editing by id rather than by code, so correcting a code renames one plan
 * instead of quietly writing a second and leaving the first live — the same
 * mistake the JSLAYD designs made until it was fixed there.
 *
 * `features` is checked for shape but not for contents: which capabilities
 * exist is the product's business and changes, and a whitelist here would mean
 * a migration every time one is added. What is refused is a value that is not
 * an object, because everything downstream reads it with `->`.
 */
create or replace function public.admin_save_subscription_plan(
  p_id uuid,
  p_code text,
  p_name text,
  p_price_amount integer,
  p_features jsonb,
  p_subtitle text default '',
  p_description text default '',
  p_badge text default '',
  p_cta_label text default '',
  p_compare_at_amount integer default 0,
  p_currency text default 'UZS',
  p_period_days integer default 30,
  p_estimated_cost_amount integer default 0,
  p_is_active boolean default true,
  p_is_featured boolean default false,
  p_sort_order integer default 0
)
returns public.subscription_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_plan public.subscription_plans%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_features, 'null'::jsonb)) <> 'object' then
    raise exception 'features must be an object' using errcode = '22023';
  end if;

  if p_id is not null then
    select to_jsonb(row) into v_before from public.subscription_plans row where row.id = p_id;
    if v_before is null then
      raise exception 'plan_not_found' using errcode = '02000';
    end if;
    if exists (select 1 from public.subscription_plans where code = p_code and id <> p_id) then
      raise exception 'code_taken' using errcode = '23505';
    end if;

    update public.subscription_plans set
      code = p_code, name = p_name, subtitle = coalesce(p_subtitle, ''),
      description = coalesce(p_description, ''), badge = coalesce(p_badge, ''),
      cta_label = coalesce(p_cta_label, ''), price_amount = p_price_amount,
      compare_at_amount = coalesce(p_compare_at_amount, 0), currency = upper(p_currency),
      period_days = p_period_days, features = p_features,
      estimated_cost_amount = coalesce(p_estimated_cost_amount, 0),
      is_active = coalesce(p_is_active, true), is_featured = coalesce(p_is_featured, false),
      sort_order = coalesce(p_sort_order, 0)
    where id = p_id
    returning * into v_plan;
  else
    insert into public.subscription_plans (
      code, name, subtitle, description, badge, cta_label, price_amount,
      compare_at_amount, currency, period_days, features, estimated_cost_amount,
      is_active, is_featured, sort_order
    ) values (
      p_code, p_name, coalesce(p_subtitle, ''), coalesce(p_description, ''),
      coalesce(p_badge, ''), coalesce(p_cta_label, ''), p_price_amount,
      coalesce(p_compare_at_amount, 0), upper(p_currency), p_period_days, p_features,
      coalesce(p_estimated_cost_amount, 0), coalesce(p_is_active, true),
      coalesce(p_is_featured, false), coalesce(p_sort_order, 0)
    )
    returning * into v_plan;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, case when v_before is null then 'plan.created' else 'plan.edited' end,
          'subscription_plan', v_plan.id::text, v_before, to_jsonb(v_plan));

  return v_plan;
end;
$$;

revoke all on function public.admin_save_subscription_plan(
  uuid, text, text, integer, jsonb, text, text, text, text, integer, text, integer, integer, boolean, boolean, integer)
  from public, anon;
grant execute on function public.admin_save_subscription_plan(
  uuid, text, text, integer, jsonb, text, text, text, text, integer, text, integer, integer, boolean, boolean, integer)
  to authenticated;

/**
 * What the plans are actually doing.
 *
 * Counted from rows that already exist rather than from a tally kept alongside:
 * a running total is a thing that can drift from the truth it summarises, and
 * these are small tables.
 *
 * `estimated_cost_amount` is what an admin believes a member costs. It is a
 * belief, so the margin here is labelled an estimate and never blocks anything
 * — the warning belongs to whoever is setting the price.
 */
create or replace function public.admin_subscription_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plans jsonb;
  v_totals jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row.sort_order), '[]'::jsonb) into v_plans
  from (
    select p.id, p.code, p.name, p.price_amount, p.currency, p.period_days,
           p.estimated_cost_amount, p.is_active, p.is_featured, p.sort_order,
           count(s.id) filter (where s.status = 'active' and s.expires_at > now()) as members,
           count(s.id) filter (where s.status = 'expired'
             or (s.status = 'active' and s.expires_at <= now())) as lapsed,
           count(s.id) filter (where s.status = 'cancelled') as cancelled,
           -- Monthly recurring revenue normalised to thirty days, so plans of
           -- different lengths can be added together honestly.
           round(coalesce(sum(
             case when s.status = 'active' and s.expires_at > now()
                  then p.price_amount::numeric * 30 / greatest(p.period_days, 1)
                  else 0 end), 0))::bigint as mrr
      from public.subscription_plans p
      left join public.user_subscriptions s on s.plan_id = p.id
     group by p.id
  ) row;

  select jsonb_build_object(
    'members', count(*) filter (where status = 'active' and expires_at > now()),
    'new_this_month', count(*) filter (where created_at >= date_trunc('month', now())),
    'lapsed', count(*) filter (where status = 'expired'
      or (status = 'active' and expires_at <= now())),
    'cancelled', count(*) filter (where status = 'cancelled')
  ) into v_totals
  from public.user_subscriptions;

  return jsonb_build_object(
    'plans', v_plans,
    'totals', coalesce(v_totals, '{}'::jsonb),
    'usage', (
      select coalesce(jsonb_object_agg(feature_key, total), '{}'::jsonb)
        from (select feature_key, sum(used)::bigint as total
                from public.subscription_usage
               where period_start >= (current_date - 30)
               group by feature_key) u
    ),
    'jcoin_spent_30d', (
      select coalesce(sum(abs(amount)), 0)::bigint
        from public.credit_transactions
       where type = 'charge' and created_at >= now() - interval '30 days'
    )
  );
end;
$$;

revoke all on function public.admin_subscription_overview() from public, anon;
grant execute on function public.admin_subscription_overview() to authenticated;
