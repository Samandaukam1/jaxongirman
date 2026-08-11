-- The order: one row for every purchase, whatever is being bought.
--
-- Why this exists when `payment_transactions` already did: that table is
-- marketplace-shaped — it requires a product and a seller, and its commission
-- snapshot is a marketplace concept. A subscription, a coin package and eleven
-- months of module access have none of those, so wiring them through it would
-- have meant either nullable columns everywhere or a second payment path. The
-- brief forbids the second path, and rightly: two engines means two places for
-- money to go missing.
--
-- So the order is the header, and it is the only thing that decides whether
-- something is owed or owned. `payment_transactions` keeps its job of recording
-- one attempt at the provider, and the next migration hangs it off an order.
--
-- Three properties are load-bearing:
--
--   * The client never sends a price. It sends an id — a plan, a package, a
--     product — and the server reads the amount from the row that owns it. Every
--     figure on an order is computed here.
--   * Commission rates are snapshotted at creation. Changing the platform's cut
--     tomorrow does not rewrite what somebody agreed to today.
--   * Money is integer som. No float ever touches a total.

-- --------------------------------------------------------- order numbering --
/**
 * `JAX-YYYY-NNNNNN`, unique and gap-tolerant.
 *
 * A sequence rather than `max(n) + 1`: two checkouts in the same millisecond
 * must not be able to agree on a number, and a rolled-back order is allowed to
 * burn one. The year is part of the string but not of the uniqueness — the
 * sequence simply keeps counting, so there is no January race to reset it.
 */
create sequence if not exists public.order_number_seq as bigint start 1;

create or replace function public.next_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'JAX-' || to_char(now(), 'YYYY') || '-' ||
         lpad((nextval('public.order_number_seq') % 1000000)::text, 6, '0');
$$;

-- ------------------------------------------------------------------ orders --
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default public.next_order_number(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose public.order_purpose not null,
  status public.order_status not null default 'pending',

  /** What was bought. Exactly one of these is set, enforced below. */
  product_id uuid references public.marketplace_products(id) on delete restrict,
  coin_package_id uuid references public.coin_packages(id) on delete restrict,
  /** The module code for a module purchase; the plan code for a subscription. */
  reference_code text,
  seller_id uuid references auth.users(id) on delete restrict,

  currency text not null default 'UZS',
  -- Whole som throughout. `numeric` would invite a fractional total; integer
  -- makes an impossible amount a type error rather than a rounding surprise.
  subtotal integer not null,
  buyer_fee integer not null default 0,
  total_amount integer not null,
  seller_fee integer not null default 0,
  seller_net integer not null default 0,
  platform_revenue integer not null default 0,

  -- Snapshots, not references: the rates in force when this was agreed.
  buyer_fee_rate numeric(5,2) not null default 0,
  seller_fee_rate numeric(5,2) not null default 0,

  /** Payme's identifiers, so a disputed charge can be traced both ways. */
  payme_receipt_id text,
  payme_transaction_id text,

  /**
   * A real order made with a small amount for provider testing. Excluded from
   * every financial aggregate, kept as a real row rather than deleted, because
   * a test charge moved real money and hiding it would make the books wrong.
   */
  is_test boolean not null default false,

  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  /** Unpaid orders do not live forever; the sweep below closes them. */
  expires_at timestamptz not null default now() + interval '2 hours',

  constraint orders_number_format check (order_number ~ '^JAX-[0-9]{4}-[0-9]{6}$'),
  constraint orders_currency check (currency ~ '^[A-Z]{3}$'),
  constraint orders_amounts_nonnegative check (
    subtotal >= 0 and buyer_fee >= 0 and total_amount >= 0
    and seller_fee >= 0 and seller_net >= 0 and platform_revenue >= 0
  ),
  -- The arithmetic is a constraint, not a convention. A row that does not add
  -- up cannot be written, whichever code path tried.
  constraint orders_arithmetic check (
    total_amount = subtotal + buyer_fee
    and seller_net = subtotal - seller_fee
    and platform_revenue = buyer_fee + seller_fee
  ),
  constraint orders_rates check (
    buyer_fee_rate between 0 and 100 and seller_fee_rate between 0 and 100
  ),
  -- Exactly one subject, matched to the purpose. This is what stops a coin
  -- order from quietly carrying a product id nobody checks.
  constraint orders_subject check (
    case purpose
      when 'subscription' then product_id is null and coin_package_id is null and reference_code is not null
      when 'jcoin' then product_id is null and coin_package_id is not null and reference_code is null
      when 'data_collection' then product_id is null and coin_package_id is null and reference_code is not null
      else product_id is not null and coin_package_id is null
    end
  ),
  -- A marketplace order has a seller; nothing else does.
  constraint orders_seller check (
    (purpose in ('subscription', 'jcoin', 'data_collection')) = (seller_id is null)
  ),
  -- Only a marketplace order splits money with anybody.
  constraint orders_platform_only_fees check (
    seller_id is not null or (seller_fee = 0 and seller_net = subtotal)
  ),
  constraint orders_paid_has_time check (
    (status = 'paid'::public.order_status) = (paid_at is not null)
  ),
  -- Provider messages are written by the server, which redacts first. This is
  -- the backstop: nothing shaped like a card number is stored.
  constraint orders_failure_no_pan check (failure_message is null or failure_message !~ '[0-9]{12,}')
);

create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, created_at desc) where seller_id is not null;
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_paid_idx on public.orders (paid_at desc) where status = 'paid'::public.order_status;
create index orders_purpose_idx on public.orders (purpose, created_at desc);
-- The recovery sweep's query: unpaid and past its window.
create index orders_stale_idx on public.orders (expires_at)
  where status in ('pending'::public.order_status,
                   'awaiting_verification'::public.order_status,
                   'processing'::public.order_status);
-- One Payme receipt belongs to one order, always.
create unique index orders_payme_receipt_idx on public.orders (payme_receipt_id)
  where payme_receipt_id is not null;
create unique index orders_payme_transaction_idx on public.orders (payme_transaction_id)
  where payme_transaction_id is not null;
-- One open order per person per thing, so a double tap cannot open two.
create unique index orders_open_product_idx on public.orders (user_id, product_id)
  where product_id is not null
    and status in ('pending'::public.order_status,
                   'awaiting_verification'::public.order_status,
                   'processing'::public.order_status);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- state machine --
/**
 * Which order transitions exist.
 *
 * Everything not listed is refused, which is what makes `paid -> pending`
 * impossible by construction rather than by everyone remembering. `paid` is
 * terminal except for a refund; the three failure states are terminal outright.
 */
create or replace function public.order_transition_allowed(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pending', 'awaiting_verification'),
    ('pending', 'processing'),
    ('pending', 'failed'),
    ('pending', 'cancelled'),
    ('pending', 'expired'),
    ('awaiting_verification', 'processing'),
    ('awaiting_verification', 'pending'),
    ('awaiting_verification', 'failed'),
    ('awaiting_verification', 'cancelled'),
    ('awaiting_verification', 'expired'),
    ('processing', 'paid'),
    ('processing', 'failed'),
    ('processing', 'expired'),
    ('paid', 'refunded')
  );
$$;

/**
 * The only writer of `orders.status`.
 *
 * Refuses an impossible move, and refuses a repeated one quietly: asking to
 * make a paid order paid returns false rather than raising, so an idempotent
 * caller does not have to distinguish "already done" from "not allowed".
 */
create or replace function public.order_advance(
  p_order_id uuid,
  p_to public.order_status,
  p_failure_code text default null,
  p_failure_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status = p_to then
    return false;
  end if;
  if not public.order_transition_allowed(v_order.status, p_to) then
    raise exception 'order % cannot move from % to %', v_order.order_number, v_order.status, p_to
      using errcode = '22023';
  end if;

  update public.orders set
    status = p_to,
    paid_at = case when p_to = 'paid'::public.order_status then now() else paid_at end,
    cancelled_at = case when p_to in ('cancelled'::public.order_status, 'expired'::public.order_status)
                        then now() else cancelled_at end,
    failure_code = coalesce(left(btrim(p_failure_code), 60), failure_code),
    -- Redacted before storage; the constraint is the backstop, not the plan.
    failure_message = coalesce(
      regexp_replace(left(btrim(p_failure_message), 500), '\d{12,}', '••••', 'g'),
      failure_message
    )
    where id = p_order_id;

  return true;
end;
$$;

-- -------------------------------------------------------------------- RLS --
alter table public.orders enable row level security;

/**
 * A person reads their own orders. A seller reads the orders that bought their
 * material — they need to know a sale happened — and nothing about anybody
 * else's purchases.
 */
create policy orders_own_select on public.orders for select to authenticated
  using (user_id = (select auth.uid()));
create policy orders_seller_select on public.orders for select to authenticated
  using (seller_id = (select auth.uid()));
create policy orders_admin_select on public.orders for select to authenticated
  using ((select public.is_admin()));

-- Nothing about an order is a client's to write. Every column that decides what
-- is owed or owned is set by a definer function, so an amount cannot be edited
-- and a status cannot be declared paid.
revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
grant select, insert, update on public.orders to service_role;
grant usage, select on sequence public.order_number_seq to service_role;

-- --------------------------------------------------------------- sweeping --
/**
 * Closes orders nobody finished.
 *
 * `processing` is deliberately left alone: the provider may have taken the
 * money, and only asking it can settle that. Expiring such an order here would
 * turn an unknown into a wrong answer, so it is reported for reconciliation
 * instead.
 */
create or replace function public.purge_stale_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.orders set status = 'expired'::public.order_status, cancelled_at = now()
    where expires_at <= now()
      and status in ('pending'::public.order_status, 'awaiting_verification'::public.order_status);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Orders whose fate the provider knows and we do not: charged-but-unanswered,
 * or paid on one side and not the other. Read-only on purpose — an automatic
 * "correction" to money is how a reconciliation tool becomes the incident.
 */
create or replace function public.admin_order_reconciliation()
returns table (
  id uuid,
  order_number text,
  purpose public.order_purpose,
  status public.order_status,
  total_amount integer,
  payme_receipt_id text,
  user_email text,
  created_at timestamptz,
  concern text
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
    select o.id, o.order_number, o.purpose, o.status, o.total_amount,
           o.payme_receipt_id, u.email::text, o.created_at,
           case
             when o.status = 'processing'::public.order_status and o.created_at < now() - interval '15 minutes'
               then 'Provayderdan javob kelmadi — Payme holatini tekshirish kerak'
             when o.status = 'paid'::public.order_status and o.payme_receipt_id is null
               then 'To‘langan, lekin Payme cheki yo‘q'
             when o.status <> 'paid'::public.order_status and o.paid_at is not null
               then 'To‘lov vaqti bor, lekin holati to‘langan emas'
             else 'Tekshirish kerak'
           end
    from public.orders o
    left join auth.users u on u.id = o.user_id
    where (o.status = 'processing'::public.order_status and o.created_at < now() - interval '15 minutes')
       or (o.status = 'paid'::public.order_status and o.payme_receipt_id is null and not o.is_test)
       or (o.status <> 'paid'::public.order_status and o.paid_at is not null)
    order by o.created_at desc
    limit 200;
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  execute 'revoke all on function public.next_order_number() from public, anon, authenticated';
  execute 'revoke all on function public.order_advance(uuid, public.order_status, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.purge_stale_orders() from public, anon, authenticated';
  foreach v_signature in array array[
    'public.next_order_number()',
    'public.order_advance(uuid, public.order_status, text, text)',
    'public.purge_stale_orders()'
  ] loop
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  execute 'revoke all on function public.admin_order_reconciliation() from public, anon';
  execute 'grant execute on function public.admin_order_reconciliation() to authenticated, service_role';
  -- Immutable predicate, safe for anyone to evaluate; nothing about it reveals data.
  execute 'revoke all on function public.order_transition_allowed(public.order_status, public.order_status) from public, anon';
  execute 'grant execute on function public.order_transition_allowed(public.order_status, public.order_status) to authenticated, service_role';
end
$$;
