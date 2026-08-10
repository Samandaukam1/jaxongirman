-- A books module for the console: what the platform earns, what it pays out,
-- and what is still owed to the AI provider today.
--
-- Nothing here is derived from payment-provider data, because none is wired up
-- yet. Income is recorded by hand; when purchases start landing in
-- credit_transactions they can be folded in without changing this shape.

create type public.finance_kind as enum ('income', 'expense');
create type public.finance_source as enum ('ai_provider', 'infrastructure', 'subscription', 'credit_sale', 'other');
-- Whether an amount is a single event or the price of a recurring period. A
-- monthly hosting bill has to show up in the weekly view as its weekly share,
-- otherwise the two cards tell different stories about the same money.
create type public.finance_period as enum ('one_time', 'weekly', 'monthly');

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  kind public.finance_kind not null,
  source public.finance_source not null,
  period public.finance_period not null default 'one_time',
  amount_usd numeric(14,4) not null,
  occurred_on date not null default current_date,
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_entries_amount_positive check (amount_usd > 0),
  constraint finance_entries_note_length check (char_length(note) <= 500)
);

create index finance_entries_occurred_idx on public.finance_entries(occurred_on desc, created_at desc);
create index finance_entries_kind_idx on public.finance_entries(kind, source, occurred_on desc);

-- The dashboard's settle button posts one AI payment per day; the index is what
-- makes pressing it twice a no-op rather than a double charge.
create unique index finance_entries_ai_daily_idx
  on public.finance_entries(occurred_on)
  where source = 'ai_provider';

alter table public.finance_entries enable row level security;
comment on table public.finance_entries is
  'Manual income and expense ledger. No direct table access: every read and write goes through an admin security-definer RPC.';

insert into public.app_settings (key, value, description, public_read)
values (
  'finance.usd_uzs_rate',
  -- The Central Bank's rate on the day this shipped. The refresh function
  -- replaces it with the live figure; this only keeps the first render honest.
  '{"rate": 11915.64, "source": "cbu.uz 07.08.2026", "updated_at": null}'::jsonb,
  'USD to UZS rate used by the admin console. Refreshed from the Central Bank by the refresh-usd-rate function.',
  false
)
on conflict (key) do nothing;

/**
 * Days in the current month, used to spread a monthly cost across a week and a
 * weekly cost across a month so both cards describe the same underlying spend.
 */
create or replace function public.finance_month_days()
returns numeric
language sql
stable
set search_path = ''
as $$
  select extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::numeric;
$$;

/** Sums a period's entries, converting recurring amounts into that period. */
create or replace function public.finance_period_total(
  p_kind public.finance_kind,
  p_from date,
  p_scale public.finance_period
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when entry.period = p_scale or entry.period = 'one_time' then entry.amount_usd
      when p_scale = 'weekly' and entry.period = 'monthly' then entry.amount_usd * 7 / public.finance_month_days()
      when p_scale = 'monthly' and entry.period = 'weekly' then entry.amount_usd * public.finance_month_days() / 7
      else entry.amount_usd
    end
  ), 0)
  from public.finance_entries as entry
  where entry.kind = p_kind and entry.occurred_on >= p_from;
$$;

/**
 * Everything the finance screens need in one round trip: the exchange rate, what
 * the AI provider is still owed, and this week's and this month's books.
 */
create or replace function public.admin_finance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_rate numeric;
  v_rate_meta jsonb;
  v_ai_total numeric;
  v_ai_paid numeric;
  v_week_income numeric;
  v_week_expense numeric;
  v_month_income numeric;
  v_month_expense numeric;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select value into v_rate_meta from public.app_settings where key = 'finance.usd_uzs_rate';
  v_rate := coalesce((v_rate_meta ->> 'rate')::numeric, 0);

  select coalesce(sum(provider_cost_usd), 0) into v_ai_total from public.ai_usage;
  select coalesce(sum(amount_usd), 0) into v_ai_paid
    from public.finance_entries where source = 'ai_provider';

  v_week_income := public.finance_period_total('income', v_week_start, 'weekly');
  v_week_expense := public.finance_period_total('expense', v_week_start, 'weekly');
  v_month_income := public.finance_period_total('income', v_month_start, 'monthly');
  v_month_expense := public.finance_period_total('expense', v_month_start, 'monthly');

  return jsonb_build_object(
    'rate', jsonb_build_object(
      'value', v_rate,
      'source', coalesce(v_rate_meta ->> 'source', 'seed'),
      'updated_at', v_rate_meta ->> 'updated_at'
    ),
    'ai', jsonb_build_object(
      'total_usd', round(v_ai_total, 6),
      'paid_usd', round(v_ai_paid, 4),
      -- Never negative: overpaying the provider should read as "nothing due".
      'due_usd', round(greatest(v_ai_total - v_ai_paid, 0), 6),
      'settled_today', exists (
        select 1 from public.finance_entries
        where source = 'ai_provider' and occurred_on = current_date
      )
    ),
    'week', jsonb_build_object(
      'start', v_week_start,
      'income_usd', round(v_week_income, 4),
      'expense_usd', round(v_week_expense, 4),
      'profit_usd', round(v_week_income - v_week_expense, 4)
    ),
    'month', jsonb_build_object(
      'start', v_month_start,
      'income_usd', round(v_month_income, 4),
      'expense_usd', round(v_month_expense, 4),
      'profit_usd', round(v_month_income - v_month_expense, 4)
    )
  );
end;
$$;

create or replace function public.admin_list_finance_entries(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.finance_kind,
  source public.finance_source,
  period public.finance_period,
  amount_usd numeric,
  occurred_on date,
  note text,
  created_by_email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
    select entry.id, entry.kind, entry.source, entry.period, entry.amount_usd,
           entry.occurred_on, entry.note, author.email::text, entry.created_at
    from public.finance_entries as entry
    left join auth.users as author on author.id = entry.created_by
    order by entry.occurred_on desc, entry.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_record_finance_entry(
  p_kind public.finance_kind,
  p_source public.finance_source,
  p_amount_usd numeric,
  p_period public.finance_period default 'one_time',
  p_occurred_on date default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.finance_entries%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'amount must be greater than zero' using errcode = '22023';
  end if;

  insert into public.finance_entries (kind, source, period, amount_usd, occurred_on, note, created_by)
  values (
    p_kind, p_source, coalesce(p_period, 'one_time'), round(p_amount_usd, 4),
    coalesce(p_occurred_on, current_date), left(btrim(coalesce(p_note, '')), 500), v_admin
  )
  returning * into v_row;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data, reason)
  values (v_admin, 'finance.record', 'finance_entry', v_row.id::text, to_jsonb(v_row), left(btrim(coalesce(p_note, '')), 500));

  return to_jsonb(v_row);
end;
$$;

/**
 * The dashboard's "paid" button. Settles whatever the AI provider is still owed
 * as one entry dated today. Pressing it again the same day changes nothing.
 */
create or replace function public.admin_settle_ai_cost(p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_total numeric;
  v_paid numeric;
  v_due numeric;
  v_row public.finance_entries%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_row from public.finance_entries
    where source = 'ai_provider' and occurred_on = current_date;
  if found then
    return jsonb_build_object('applied', false, 'entry', to_jsonb(v_row), 'message', 'already settled today');
  end if;

  select coalesce(sum(provider_cost_usd), 0) into v_total from public.ai_usage;
  select coalesce(sum(amount_usd), 0) into v_paid from public.finance_entries where source = 'ai_provider';
  v_due := round(greatest(v_total - v_paid, 0), 4);
  if v_due <= 0 then
    raise exception 'nothing is owed to the AI provider right now' using errcode = '22023';
  end if;

  insert into public.finance_entries (kind, source, period, amount_usd, occurred_on, note, created_by)
  values ('expense', 'ai_provider', 'one_time', v_due, current_date,
          left(btrim(coalesce(nullif(p_note, ''), 'AI provayder hisobi to‘landi')), 500), v_admin)
  returning * into v_row;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data, reason)
  values (v_admin, 'finance.settle_ai', 'finance_entry', v_row.id::text, to_jsonb(v_row), 'AI provider settlement');

  return jsonb_build_object('applied', true, 'entry', to_jsonb(v_row));
end;
$$;

create or replace function public.admin_delete_finance_entry(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.finance_entries%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  delete from public.finance_entries where id = p_id returning * into v_row;
  if not found then
    raise exception 'finance entry not found' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, reason)
  values (v_admin, 'finance.delete', 'finance_entry', p_id::text, to_jsonb(v_row), 'Entry removed');
  return true;
end;
$$;

/** Writes the exchange rate. Called by the refresh function and by admins. */
create or replace function public.admin_set_usd_rate(p_rate numeric, p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case when v_claims is null then null else v_claims::jsonb ->> 'role' end,
    ''
  );
  v_value jsonb;
begin
  if not (
    (v_caller is not null and public.is_admin(v_caller))
    or v_request_role = 'service_role'
    or (v_claims is null and v_request_role = '')
  ) then
    raise exception 'admin role or service role required' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'rate must be greater than zero' using errcode = '22023';
  end if;

  v_value := jsonb_build_object(
    'rate', round(p_rate, 2),
    'source', left(coalesce(nullif(btrim(p_source), ''), 'manual'), 60),
    'updated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  update public.app_settings set value = v_value, updated_at = now() where key = 'finance.usd_uzs_rate';
  if not found then
    insert into public.app_settings (key, value, description, public_read)
    values ('finance.usd_uzs_rate', v_value, 'USD to UZS rate used by the admin console.', false);
  end if;
  return v_value;
end;
$$;

revoke all on function public.finance_period_total(public.finance_kind, date, public.finance_period) from public;
revoke all on function public.finance_month_days() from public;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_finance_overview()',
    'public.admin_list_finance_entries(integer, integer)',
    'public.admin_record_finance_entry(public.finance_kind, public.finance_source, numeric, public.finance_period, date, text)',
    'public.admin_settle_ai_cost(text)',
    'public.admin_delete_finance_entry(uuid)',
    'public.admin_set_usd_rate(numeric, text)'
  ]
  loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
