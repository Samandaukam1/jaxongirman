-- Lets the payment flow be built and exercised before a provider exists,
-- without a single sandbox som reaching a financial report.
--
-- The pattern is the one this codebase already uses for the AI pipeline, where
-- `GENERATION_MODE=mock` produces a deck without calling OpenAI. A payment is a
-- heavier thing to fake, so the sandbox leaves a mark on every row it creates:
--
--   * `provider` records which adapter settled the transaction.
--   * `is_sandbox` is carried onto the purchase and the seller's ledger entry.
--   * `admin_marketplace_finance()` counts only real money.
--   * A seller settlement can never include a sandbox sale.
--
-- The result is that a sandbox purchase behaves exactly like a real one for
-- everything a developer needs to test — entitlement, download, library,
-- notifications — and like nothing at all for everything an accountant sees.

alter table public.payment_transactions
  drop constraint if exists payment_transactions_provider_known;
alter table public.payment_transactions
  add constraint payment_transactions_provider_known check (provider in ('payme', 'mock'));

alter table public.payment_transactions
  add column if not exists is_sandbox boolean not null default false;
alter table public.marketplace_purchases
  add column if not exists is_sandbox boolean not null default false;
alter table public.seller_ledger_entries
  add column if not exists is_sandbox boolean not null default false;

-- Finding and clearing sandbox rows has to be cheap; before a launch someone
-- will want to delete every one of them.
create index if not exists payment_transactions_sandbox_idx
  on public.payment_transactions (created_at desc) where is_sandbox;
create index if not exists marketplace_purchases_sandbox_idx
  on public.marketplace_purchases (purchased_at desc) where is_sandbox;

comment on column public.payment_transactions.is_sandbox is
  'True when a non-production adapter settled this transaction. Excluded from every financial aggregate.';

/**
 * Settles a confirmed payment, carrying the sandbox flag through to everything
 * the sale creates.
 *
 * Replaces the previous version: the only change is that `is_sandbox` now
 * travels from the transaction onto the purchase and the ledger entry, so a
 * test purchase can never be mistaken for revenue or paid out to a seller.
 */
create or replace function public.marketplace_settle_payment(
  p_transaction_id uuid,
  p_provider_cost integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.payment_transactions%rowtype;
  v_product public.marketplace_products%rowtype;
  v_purchase public.marketplace_purchases%rowtype;
begin
  select * into v_transaction from public.payment_transactions where id = p_transaction_id for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;

  select * into v_purchase from public.marketplace_purchases where transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object('applied', false, 'purchase_id', v_purchase.id, 'message', 'already settled');
  end if;

  if v_transaction.state <> 'processing'::public.payment_state then
    raise exception 'only a processing payment can settle' using errcode = '22023';
  end if;

  select * into v_product from public.marketplace_products where id = v_transaction.product_id;

  update public.payment_transactions
    set state = 'paid'::public.payment_state, paid_at = now(), provider_cost = greatest(coalesce(p_provider_cost, 0), 0)
    where id = p_transaction_id
    returning * into v_transaction;

  insert into public.marketplace_purchases (
    transaction_id, buyer_id, seller_id, product_id,
    base_price, currency, buyer_fee_rate, buyer_fee_amount, buyer_total,
    seller_fee_rate, seller_fee_amount, seller_net, platform_gross, provider_cost, is_sandbox
  ) values (
    v_transaction.id, v_transaction.buyer_id, v_transaction.seller_id, v_transaction.product_id,
    v_transaction.base_price, v_transaction.currency,
    v_transaction.buyer_fee_rate, v_transaction.buyer_fee_amount, v_transaction.buyer_total,
    v_transaction.seller_fee_rate, v_transaction.seller_fee_amount, v_transaction.seller_net,
    v_transaction.platform_gross, v_transaction.provider_cost, v_transaction.is_sandbox
  )
  returning * into v_purchase;

  insert into public.purchase_entitlements (purchase_id, user_id, product_id)
  values (v_purchase.id, v_transaction.buyer_id, v_transaction.product_id);

  insert into public.seller_ledger_entries (
    seller_id, purchase_id, product_id, gross_amount, fee_amount, net_amount, currency, is_sandbox
  ) values (
    v_transaction.seller_id, v_purchase.id, v_transaction.product_id,
    v_transaction.base_price, v_transaction.seller_fee_amount, v_transaction.seller_net,
    v_transaction.currency, v_transaction.is_sandbox
  );

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_transaction.buyer_id, 'marketplace_purchase',
    case when v_transaction.is_sandbox then 'Sinov xaridi yakunlandi' else 'Xarid muvaffaqiyatli' end,
    '“' || v_product.title || '” endi kutubxonangizda. Yuklab olishingiz mumkin.',
    jsonb_build_object('product_id', v_product.id, 'purchase_id', v_purchase.id,
                       'amount', v_transaction.buyer_total, 'sandbox', v_transaction.is_sandbox),
    '/(app)/marketplace/library', v_purchase.id
  );

  -- A seller is only told they earned something when they actually did.
  if not v_transaction.is_sandbox then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_transaction.seller_id, 'marketplace_sale',
      'Yangi sotuv',
      '“' || v_product.title || '” sotildi. Sizga hisoblandi: ' || v_transaction.seller_net || ' so‘m.',
      jsonb_build_object('product_id', v_product.id, 'purchase_id', v_purchase.id, 'net', v_transaction.seller_net),
      '/(app)/earnings', v_purchase.id
    );
  end if;

  insert into public.payment_audit_events (transaction_id, event, state_from, state_to, message)
  values (
    p_transaction_id, 'payment.settled', 'processing'::public.payment_state, 'paid'::public.payment_state,
    case when v_transaction.is_sandbox then 'Entitlement granted (sandbox)' else 'Entitlement granted' end
  );

  return jsonb_build_object(
    'applied', true, 'purchase_id', v_purchase.id, 'entitlement', true, 'sandbox', v_transaction.is_sandbox
  );
end;
$$;

/** Sales the seller is actually owed for. Sandbox rows are not money. */
create or replace function public.seller_earnings_summary(p_seller_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_seller_id <> v_caller and not public.is_admin(v_caller) then
    raise exception 'only the seller may read these earnings' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'sales_count', (select count(*) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'gross_total', (select coalesce(sum(gross_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'fee_total', (select coalesce(sum(fee_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'net_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id and not is_sandbox),
    'pending_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                      where seller_id = p_seller_id and not is_sandbox
                        and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)),
    'paid_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                   where seller_id = p_seller_id and not is_sandbox and status = 'paid'::public.seller_ledger_status),
    'sandbox_sales', (select count(*) from public.seller_ledger_entries where seller_id = p_seller_id and is_sandbox),
    'contact', (select jsonb_build_object('phone', c.phone, 'telegram_username', c.telegram_username)
                from public.seller_payout_contacts c where c.user_id = p_seller_id),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'period_start', s.period_start, 'period_end', s.period_end,
        'gross_sales', s.gross_sales, 'seller_fees', s.seller_fees, 'payable_amount', s.payable_amount,
        'currency', s.currency, 'status', s.status,
        'destination_note', s.destination_note, 'reference', s.reference,
        'paid_at', s.paid_at, 'created_at', s.created_at
      ) order by s.period_end desc)
      from public.seller_settlements s where s.seller_id = p_seller_id
    ), '[]'::jsonb)
  );
end;
$$;

/** A payout run never claims a sandbox sale. */
create or replace function public.admin_create_settlement(
  p_seller_id uuid,
  p_period_start date,
  p_period_end date
)
returns public.seller_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_settlement public.seller_settlements%rowtype;
  v_gross integer;
  v_fees integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  insert into public.seller_settlements (seller_id, period_start, period_end, status, created_by)
  values (p_seller_id, p_period_start, p_period_end, 'pending'::public.settlement_status, v_admin)
  returning * into v_settlement;

  with claimed as (
    select id, gross_amount, fee_amount
    from public.seller_ledger_entries
    where seller_id = p_seller_id
      and settlement_id is null
      and not is_sandbox
      and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)
      and created_at::date between p_period_start and p_period_end
    for update skip locked
  ), linked as (
    insert into public.seller_settlement_items (settlement_id, ledger_entry_id)
    select v_settlement.id, id from claimed
    on conflict (ledger_entry_id) do nothing
    returning ledger_entry_id
  )
  select coalesce(sum(c.gross_amount), 0), coalesce(sum(c.fee_amount), 0)
    into v_gross, v_fees
  from claimed c join linked l on l.ledger_entry_id = c.id;

  update public.seller_ledger_entries
    set settlement_id = v_settlement.id, status = 'approved'::public.seller_ledger_status
    where id in (select ledger_entry_id from public.seller_settlement_items where settlement_id = v_settlement.id);

  update public.seller_settlements
    set gross_sales = v_gross, seller_fees = v_fees, payable_amount = v_gross - v_fees
    where id = v_settlement.id
    returning * into v_settlement;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'settlement.create', 'seller_settlement', v_settlement.id::text, '{}'::jsonb, to_jsonb(v_settlement), 'Payout run created');

  return v_settlement;
end;
$$;

/**
 * The finance dashboard, counting real money only.
 *
 * Sandbox purchases are reported separately and never folded into GMV, fees or
 * net revenue — a number an accountant reads must not include a developer's
 * test purchase.
 */
create or replace function public.admin_marketplace_finance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_period record;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  for v_period in
    select * from (values
      ('today', date_trunc('day', now())),
      ('week', date_trunc('week', now())),
      ('month', date_trunc('month', now())),
      ('all_time', '-infinity'::timestamptz)
    ) as t(label, since)
  loop
    v_result := v_result || jsonb_build_object(v_period.label, (
      select jsonb_build_object(
        'gmv', coalesce(sum(base_price), 0),
        'buyer_fees', coalesce(sum(buyer_fee_amount), 0),
        'seller_fees', coalesce(sum(seller_fee_amount), 0),
        'buyer_collected', coalesce(sum(base_price + buyer_fee_amount), 0),
        'seller_payable', coalesce(sum(base_price - seller_fee_amount), 0),
        'platform_gross', coalesce(sum(platform_gross), 0),
        'provider_costs', coalesce(sum(provider_cost), 0),
        'refunded', coalesce(sum(refunded_amount), 0),
        'platform_net', coalesce(sum(platform_gross - provider_cost), 0) - coalesce(sum(refunded_amount), 0),
        'sales_count', count(*),
        'average_order_value', case when count(*) = 0 then 0
          else round(coalesce(sum(base_price + buyer_fee_amount), 0)::numeric / count(*)) end
      )
      from public.marketplace_purchases
      where purchased_at >= v_period.since and not is_sandbox
    ));
  end loop;

  return v_result || jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'gmv', d.gmv, 'platform_gross', d.platform_gross, 'sales_count', d.sales_count
      ) order by d.day)
      from (
        select purchased_at::date as day,
               sum(base_price) as gmv,
               sum(platform_gross) as platform_gross,
               count(*) as sales_count
        from public.marketplace_purchases
        where purchased_at >= now() - interval '30 days' and not is_sandbox
        group by 1
      ) d
    ), '[]'::jsonb),
    -- Surfaced deliberately: an admin should be able to see that sandbox rows
    -- exist, and how many, without them polluting a single revenue figure.
    'sandbox_purchases', (select count(*) from public.marketplace_purchases where is_sandbox),
    'pending_moderation', (select count(*) from public.marketplace_products
                           where status = 'pending_review'::public.marketplace_product_status),
    'open_reports', (select count(*) from public.marketplace_reports
                     where status in ('open'::public.marketplace_report_status, 'reviewing'::public.marketplace_report_status)),
    'unsettled_payable', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                          where not is_sandbox
                            and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status))
  );
end;
$$;

/**
 * Opens a sandbox payment. Server-side only, and it refuses to exist once a
 * real provider is configured — the sandbox cannot outlive the thing it stands
 * in for.
 */
create or replace function public.payment_begin_sandbox(p_transaction_id uuid)
returns public.payment_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payments jsonb;
  v_transaction public.payment_transactions%rowtype;
begin
  select coalesce(value, '{}'::jsonb) into v_payments from public.app_settings where key = 'payments.config';
  if coalesce((v_payments ->> 'configured')::boolean, false) then
    raise exception 'a real payment provider is configured; sandbox payments are disabled'
      using errcode = '42501';
  end if;

  update public.payment_transactions
    set provider = 'mock', is_sandbox = true
    where id = p_transaction_id and state = 'created'::public.payment_state
    returning * into v_transaction;
  if not found then
    raise exception 'transaction is not open for a sandbox payment' using errcode = '22023';
  end if;

  insert into public.payment_audit_events (transaction_id, event, state_to, message)
  values (p_transaction_id, 'sandbox.begin', v_transaction.state, 'Sandbox adapter engaged');

  return v_transaction;
end;
$$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.payment_begin_sandbox(uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('revoke all on function %s from authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
