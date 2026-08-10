-- The money half of the marketplace: what a sale costs, how a payment is
-- tracked, what a buyer gets, and what a seller is owed.
--
-- Four rules the schema enforces rather than documents:
--
--   1. Every amount is whole som in an `integer`. No float ever touches money.
--
--   2. A purchase carries its own commission figures. Changing the platform's
--      rates tomorrow cannot restate what happened yesterday, because yesterday
--      is stored, not recomputed.
--
--   3. A payment reaches `paid` only through the server-side transition
--      function. There is no client-writable column anywhere in this file that
--      can grant access to a file.
--
--   4. No card number, no missing digits, no CVV and no OTP has a column to
--      live in. The partial card table stores a masked display string and
--      nothing that could be assembled back into a PAN.

-- --------------------------------------------------------------- commission --
/**
 * The platform's cut, as configuration. Both sides are independent and both are
 * admin-editable; neither is hard-coded anywhere in either client.
 */
create table public.commission_config (
  scope text primary key,
  buyer_fee_rate numeric(5,2) not null,
  seller_fee_rate numeric(5,2) not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_config_buyer_range check (buyer_fee_rate >= 0 and buyer_fee_rate <= 100),
  constraint commission_config_seller_range check (seller_fee_rate >= 0 and seller_fee_rate <= 100)
);

create trigger commission_config_set_updated_at
  before update on public.commission_config
  for each row execute function public.set_updated_at();

insert into public.commission_config (scope, buyer_fee_rate, seller_fee_rate)
values ('marketplace', 20.00, 20.00)
on conflict (scope) do nothing;

/** Every rate change, with who made it and what it was before. */
create table public.commission_history (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  old_buyer_fee_rate numeric(5,2),
  old_seller_fee_rate numeric(5,2),
  new_buyer_fee_rate numeric(5,2) not null,
  new_seller_fee_rate numeric(5,2) not null,
  changed_by uuid references auth.users(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint commission_history_reason_length check (char_length(reason) <= 500)
);

create index commission_history_scope_idx on public.commission_history (scope, created_at desc);

/**
 * What a listing costs each side, using the rates in force right now.
 *
 * The single place the arithmetic lives. Checkout snapshots the result; the
 * seller's price calculator reads it live; neither client computes a fee.
 */
create or replace function public.marketplace_quote(
  p_base_price integer,
  p_scope text default 'marketplace'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.commission_config%rowtype;
  v_buyer_fee integer;
  v_seller_fee integer;
begin
  if p_base_price is null or p_base_price < 0 then
    raise exception 'price must not be negative' using errcode = '22023';
  end if;

  select * into v_config from public.commission_config where scope = p_scope;
  if not found then
    raise exception 'commission scope % is not configured', p_scope using errcode = '22023';
  end if;

  -- Rounded to whole som once, here, so buyer_total and seller_net can never
  -- disagree with the fee amounts stored beside them.
  v_buyer_fee := round(p_base_price * v_config.buyer_fee_rate / 100)::integer;
  v_seller_fee := round(p_base_price * v_config.seller_fee_rate / 100)::integer;

  return jsonb_build_object(
    'base_price', p_base_price,
    'currency', 'UZS',
    'buyer_fee_rate', v_config.buyer_fee_rate,
    'buyer_fee_amount', v_buyer_fee,
    'buyer_total', p_base_price + v_buyer_fee,
    'seller_fee_rate', v_config.seller_fee_rate,
    'seller_fee_amount', v_seller_fee,
    'seller_net', p_base_price - v_seller_fee,
    'platform_gross', v_buyer_fee + v_seller_fee
  );
end;
$$;

comment on function public.marketplace_quote(integer, text) is
  'The one place marketplace fee arithmetic lives. Checkout snapshots its output; nothing recomputes a historical sale from it.';

-- ------------------------------------------------------------ partial cards --
/**
 * A card the person has paid with before, stored as the masked string the UI
 * shows and nothing else.
 *
 * There is deliberately no column for the full number, for the four hidden
 * digits, for a CVV, for an OTP, or for a reusable provider token. The middle
 * four digits are re-entered by the person at each checkout and exist only in
 * the memory of that attempt; the provider is handed a one-time token that is
 * never saved.
 */
create table public.partial_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Exactly '########XXXX####'. The constraint is the storage rule. */
  display_pan text not null,
  last4 text not null,
  expiry_month smallint not null,
  expiry_year smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- The same physical card must not accumulate rows across checkouts.
  unique (user_id, display_pan),
  constraint partial_cards_display_shape check (display_pan ~ '^[0-9]{8}XXXX[0-9]{4}$'),
  constraint partial_cards_last4 check (last4 ~ '^[0-9]{4}$'),
  constraint partial_cards_last4_matches check (right(display_pan, 4) = last4),
  constraint partial_cards_month check (expiry_month between 1 and 12),
  constraint partial_cards_year check (expiry_year between 24 and 99)
);

create index partial_cards_user_idx on public.partial_cards (user_id, last_used_at desc nulls last) where is_active;

comment on table public.partial_cards is
  'Masked cards for the "chala kartalar" checkout. Holds no PAN, no hidden digits, no CVV, no OTP and no reusable token — by omission, not by policy.';

-- ------------------------------------------------------ payment transactions --
create type public.payment_state as enum (
  'created', 'card_created', 'otp_requested', 'card_verified',
  'receipt_created', 'processing', 'paid', 'failed', 'cancelled', 'refunded'
);

/**
 * One attempt to pay for one listing.
 *
 * The amounts are snapshotted the moment checkout opens, so a seller changing
 * their price mid-flow cannot change what this buyer agreed to pay. `state` only
 * ever moves through the server-side transition function; no client role is
 * granted UPDATE on this table at all.
 */
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.marketplace_products(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  state public.payment_state not null default 'created',
  provider text not null default 'payme',
  /** Provider identifiers. A token here is one-time and is cleared on settle. */
  provider_receipt_id text,
  provider_error_code text,
  provider_error_message text,

  -- Commission snapshot. These are the numbers the sale is made of; nothing
  -- recomputes them from commission_config afterwards.
  base_price integer not null,
  currency text not null default 'UZS',
  buyer_fee_rate numeric(5,2) not null,
  buyer_fee_amount integer not null,
  buyer_total integer not null,
  seller_fee_rate numeric(5,2) not null,
  seller_fee_amount integer not null,
  seller_net integer not null,
  platform_gross integer not null,

  /** Provider cost for this transaction, when the provider reports one. */
  provider_cost integer not null default 0,
  partial_card_id uuid references public.partial_cards(id) on delete set null,
  idempotency_key text not null,
  paid_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A retried request is the same attempt, not a second payment.
  unique (buyer_id, idempotency_key),
  constraint payment_transactions_amounts check (
    base_price >= 0 and buyer_fee_amount >= 0 and seller_fee_amount >= 0
    and buyer_total = base_price + buyer_fee_amount
    and seller_net = base_price - seller_fee_amount
    and platform_gross = buyer_fee_amount + seller_fee_amount
    and provider_cost >= 0
  ),
  constraint payment_transactions_rates check (
    buyer_fee_rate between 0 and 100 and seller_fee_rate between 0 and 100
  ),
  constraint payment_transactions_currency check (currency ~ '^[A-Z]{3}$'),
  -- Provider messages are written by the server, which redacts before it writes.
  -- This is the backstop: nothing that looks like a card number gets stored.
  constraint payment_transactions_error_no_pan check (
    provider_error_message is null or provider_error_message !~ '[0-9]{12,}'
  )
);

create index payment_transactions_buyer_idx on public.payment_transactions (buyer_id, created_at desc);
create index payment_transactions_seller_idx on public.payment_transactions (seller_id, created_at desc);
create index payment_transactions_state_idx on public.payment_transactions (state, created_at desc);
create index payment_transactions_paid_idx on public.payment_transactions (paid_at desc) where state = 'paid'::public.payment_state;

create trigger payment_transactions_set_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

/**
 * Every state change and provider exchange, for reconstructing a disputed
 * payment. Written only by the server. Card data never reaches it: the message
 * column carries the same no-long-digit-run constraint as the transaction.
 */
create table public.payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.payment_transactions(id) on delete cascade,
  event text not null,
  state_from public.payment_state,
  state_to public.payment_state,
  provider_code text,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_audit_events_message_no_pan check (message !~ '[0-9]{12,}'),
  constraint payment_audit_events_message_length check (char_length(message) <= 1000)
);

create index payment_audit_events_transaction_idx on public.payment_audit_events (transaction_id, created_at);

-- ---------------------------------------------------------------- purchases --
/**
 * A completed sale. Exists only because a payment reached `paid`, and carries
 * the same snapshot the transaction did so a report never needs to join back.
 */
create table public.marketplace_purchases (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.payment_transactions(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references public.marketplace_products(id) on delete restrict,

  base_price integer not null,
  currency text not null default 'UZS',
  buyer_fee_rate numeric(5,2) not null,
  buyer_fee_amount integer not null,
  buyer_total integer not null,
  seller_fee_rate numeric(5,2) not null,
  seller_fee_amount integer not null,
  seller_net integer not null,
  platform_gross integer not null,
  provider_cost integer not null default 0,

  refund_status text not null default 'none',
  refunded_amount integer not null default 0,
  refunded_at timestamptz,
  purchased_at timestamptz not null default now(),

  -- One person owns a listing once. A second attempt is not a second sale.
  unique (buyer_id, product_id),
  constraint marketplace_purchases_refund_status check (refund_status in ('none', 'requested', 'partial', 'full')),
  constraint marketplace_purchases_refund_amount check (refunded_amount >= 0 and refunded_amount <= buyer_total),
  constraint marketplace_purchases_amounts check (
    buyer_total = base_price + buyer_fee_amount
    and seller_net = base_price - seller_fee_amount
    and platform_gross = buyer_fee_amount + seller_fee_amount
  )
);

create index marketplace_purchases_buyer_idx on public.marketplace_purchases (buyer_id, purchased_at desc);
create index marketplace_purchases_seller_idx on public.marketplace_purchases (seller_id, purchased_at desc);
create index marketplace_purchases_product_idx on public.marketplace_purchases (product_id, purchased_at desc);
create index marketplace_purchases_period_idx on public.marketplace_purchases (purchased_at desc);

/** What a purchase actually unlocks. Checked before any file is signed. */
create table public.purchase_entitlements (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.marketplace_purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.marketplace_products(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- One grant per person per listing, enforced by the database rather than by
  -- whichever code path happens to run.
  unique (user_id, product_id)
);

create index purchase_entitlements_user_idx on public.purchase_entitlements (user_id, granted_at desc);

/** True while this person may download this listing's files. */
create or replace function public.marketplace_has_entitlement(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchase_entitlements e
    where e.product_id = p_product_id and e.user_id = p_user_id and e.revoked_at is null
  );
$$;

-- Sales counter follows entitlements, which are the thing that only exists
-- after a real payment.
create or replace function public.marketplace_sync_sales_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.marketplace_products set sales_count = sales_count + 1 where id = new.product_id;
    return new;
  end if;
  update public.marketplace_products set sales_count = greatest(sales_count - 1, 0) where id = old.product_id;
  return old;
end;
$$;

create trigger purchase_entitlements_count_insert
  after insert on public.purchase_entitlements
  for each row execute function public.marketplace_sync_sales_count();
create trigger purchase_entitlements_count_delete
  after delete on public.purchase_entitlements
  for each row execute function public.marketplace_sync_sales_count();

-- ------------------------------------------------------------------ reviews --
/** Only people who bought the thing may rate it. */
create table public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, buyer_id),
  constraint marketplace_reviews_rating check (rating between 1 and 5),
  constraint marketplace_reviews_body_length check (char_length(body) <= 1500)
);

create index marketplace_reviews_product_idx on public.marketplace_reviews (product_id, created_at desc);

create trigger marketplace_reviews_set_updated_at
  before update on public.marketplace_reviews
  for each row execute function public.set_updated_at();

/** Keeps the product's rating aggregate true without a subquery per card. */
create or replace function public.marketplace_sync_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.marketplace_products
      set rating_sum = rating_sum + new.rating, rating_count = rating_count + 1
      where id = new.product_id;
    return new;
  elsif tg_op = 'UPDATE' then
    update public.marketplace_products
      set rating_sum = greatest(rating_sum - old.rating + new.rating, 0)
      where id = new.product_id;
    return new;
  end if;
  update public.marketplace_products
    set rating_sum = greatest(rating_sum - old.rating, 0), rating_count = greatest(rating_count - 1, 0)
    where id = old.product_id;
  return old;
end;
$$;

create trigger marketplace_reviews_sync_rating
  after insert or update or delete on public.marketplace_reviews
  for each row execute function public.marketplace_sync_rating();

-- ------------------------------------------------------------ seller ledger --
create type public.seller_ledger_status as enum ('pending', 'approved', 'paid', 'reversed');

/**
 * What the platform owes a seller, one row per sale.
 *
 * Separate from credit_transactions on purpose: that ledger is J Coin, this one
 * is som the business pays out by hand.
 */
create table public.seller_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null unique references public.marketplace_purchases(id) on delete restrict,
  product_id uuid not null references public.marketplace_products(id) on delete restrict,
  gross_amount integer not null,
  fee_amount integer not null,
  net_amount integer not null,
  currency text not null default 'UZS',
  status public.seller_ledger_status not null default 'pending',
  settlement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_ledger_amounts check (
    gross_amount >= 0 and fee_amount >= 0 and net_amount = gross_amount - fee_amount
  )
);

create index seller_ledger_seller_idx on public.seller_ledger_entries (seller_id, created_at desc);
create index seller_ledger_payable_idx on public.seller_ledger_entries (seller_id)
  where status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status);

create trigger seller_ledger_set_updated_at
  before update on public.seller_ledger_entries
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- settlements --
create type public.settlement_status as enum ('draft', 'pending', 'paid', 'cancelled');

/**
 * A payout run for one seller over one period. Created by an admin, marked paid
 * by whoever actually moved the money.
 */
create table public.seller_settlements (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  gross_sales integer not null default 0,
  seller_fees integer not null default 0,
  payable_amount integer not null default 0,
  currency text not null default 'UZS',
  status public.settlement_status not null default 'draft',
  /**
   * Where the money went, as a masked human note ("•••• 2121, Humo").
   * The constraint refuses anything with a card-length digit run, so an
   * accountant cannot turn this field into a PAN store by pasting one in.
   */
  destination_note text not null default '',
  reference text not null default '',
  /** When the seller is told payout is coming, so the reminder fires once. */
  notified_upcoming_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_settlements_period check (period_end >= period_start),
  constraint seller_settlements_amounts check (
    gross_sales >= 0 and seller_fees >= 0 and payable_amount >= 0
    and payable_amount = gross_sales - seller_fees
  ),
  constraint seller_settlements_destination_no_pan check (destination_note !~ '[0-9]{12,}'),
  constraint seller_settlements_destination_length check (char_length(destination_note) <= 200),
  constraint seller_settlements_reference_length check (char_length(reference) <= 200),
  constraint seller_settlements_paid_fields check (
    status <> 'paid'::public.settlement_status or (paid_at is not null and paid_by is not null)
  )
);

create index seller_settlements_seller_idx on public.seller_settlements (seller_id, period_end desc);
create index seller_settlements_status_idx on public.seller_settlements (status, period_end desc);

create trigger seller_settlements_set_updated_at
  before update on public.seller_settlements
  for each row execute function public.set_updated_at();

/**
 * Which ledger entries a settlement paid for. The unique key on the entry is
 * what makes double settlement impossible rather than merely unlikely.
 */
create table public.seller_settlement_items (
  settlement_id uuid not null references public.seller_settlements(id) on delete cascade,
  ledger_entry_id uuid not null unique references public.seller_ledger_entries(id) on delete restrict,
  primary key (settlement_id, ledger_entry_id)
);

alter table public.seller_ledger_entries
  add constraint seller_ledger_settlement_fk
  foreign key (settlement_id) references public.seller_settlements(id) on delete set null;

-- ------------------------------------------------------- payout contact --
/**
 * How the accountant reaches a seller when a payout is due. Deliberately not a
 * bank account: the business pays out by hand, so storing card details would
 * add compliance weight for nothing.
 */
create table public.seller_payout_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null,
  telegram_username text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_contacts_phone check (phone ~ '^\+998[0-9]{9}$'),
  constraint seller_payout_contacts_telegram check (
    telegram_username is null or telegram_username ~ '^[A-Za-z0-9_]{4,32}$'
  ),
  constraint seller_payout_contacts_note_length check (char_length(note) <= 300)
);

create trigger seller_payout_contacts_set_updated_at
  before update on public.seller_payout_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS --
alter table public.commission_config enable row level security;
alter table public.commission_history enable row level security;
alter table public.partial_cards enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_audit_events enable row level security;
alter table public.marketplace_purchases enable row level security;
alter table public.purchase_entitlements enable row level security;
alter table public.marketplace_reviews enable row level security;
alter table public.seller_ledger_entries enable row level security;
alter table public.seller_settlements enable row level security;
alter table public.seller_settlement_items enable row level security;
alter table public.seller_payout_contacts enable row level security;

-- The rates are public to anyone signed in: the seller's calculator and the
-- buyer's checkout both have to show them. Only an admin RPC writes them.
create policy commission_config_select on public.commission_config for select to authenticated using (true);
create policy commission_history_select on public.commission_history for select to authenticated
  using ((select public.is_admin()));

-- A card belongs to one person. Deletion is theirs; editing is nobody's — a
-- card record is derived from a payment, not typed in.
create policy partial_cards_select on public.partial_cards for select to authenticated
  using (user_id = (select auth.uid()));
create policy partial_cards_delete on public.partial_cards for delete to authenticated
  using (user_id = (select auth.uid()));

-- Read-only for both sides of the sale. No client role has UPDATE on a payment:
-- state moves only through the server.
create policy payment_transactions_select on public.payment_transactions for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin()));
create policy payment_audit_events_select on public.payment_audit_events for select to authenticated
  using ((select public.is_admin()));

create policy marketplace_purchases_select on public.marketplace_purchases for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin()));
create policy purchase_entitlements_select on public.purchase_entitlements for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Anyone who can see the listing can read its reviews; only someone holding an
-- entitlement can write one, and only about their own purchase.
create policy marketplace_reviews_select on public.marketplace_reviews for select to authenticated
  using (public.marketplace_can_see_product(product_id));
create policy marketplace_reviews_insert on public.marketplace_reviews for insert to authenticated
  with check (buyer_id = (select auth.uid()) and public.marketplace_has_entitlement(product_id));
create policy marketplace_reviews_update on public.marketplace_reviews for update to authenticated
  using (buyer_id = (select auth.uid())) with check (buyer_id = (select auth.uid()));
create policy marketplace_reviews_delete on public.marketplace_reviews for delete to authenticated
  using (buyer_id = (select auth.uid()) or (select public.is_admin()));

create policy seller_ledger_select on public.seller_ledger_entries for select to authenticated
  using (seller_id = (select auth.uid()) or (select public.is_admin()));
create policy seller_settlements_select on public.seller_settlements for select to authenticated
  using (seller_id = (select auth.uid()) or (select public.is_admin()));
create policy seller_settlement_items_select on public.seller_settlement_items for select to authenticated
  using (exists (
    select 1 from public.seller_settlements s
    where s.id = settlement_id and (s.seller_id = (select auth.uid()) or (select public.is_admin()))
  ));

create policy seller_payout_contacts_all on public.seller_payout_contacts for all to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ grants --
-- Read-only for clients everywhere money is involved. Every write below this
-- line happens in a security-definer function or not at all.
grant select on
  public.commission_config, public.commission_history, public.partial_cards,
  public.payment_transactions, public.payment_audit_events,
  public.marketplace_purchases, public.purchase_entitlements, public.marketplace_reviews,
  public.seller_ledger_entries, public.seller_settlements, public.seller_settlement_items,
  public.seller_payout_contacts
to authenticated;

-- The two exceptions a person legitimately owns: removing a saved card, and
-- writing a review of something they bought.
grant delete on public.partial_cards to authenticated;
grant insert, update, delete on public.marketplace_reviews to authenticated;
grant insert, update on public.seller_payout_contacts to authenticated;

grant select on
  public.commission_config, public.commission_history, public.partial_cards,
  public.payment_transactions, public.payment_audit_events,
  public.marketplace_purchases, public.purchase_entitlements, public.marketplace_reviews,
  public.seller_ledger_entries, public.seller_settlements, public.seller_settlement_items,
  public.seller_payout_contacts
to service_role;

revoke all on
  public.commission_config, public.commission_history, public.partial_cards,
  public.payment_transactions, public.payment_audit_events,
  public.marketplace_purchases, public.purchase_entitlements, public.marketplace_reviews,
  public.seller_ledger_entries, public.seller_settlements, public.seller_settlement_items,
  public.seller_payout_contacts
from anon;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.marketplace_quote(integer, text)',
    'public.marketplace_has_entitlement(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;

-- --------------------------------------------------------------- realtime --
-- A buyer watching checkout sees the state move without polling the provider.
alter publication supabase_realtime add table public.payment_transactions;
