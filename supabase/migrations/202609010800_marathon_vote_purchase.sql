-- Buying votes: escrow, transfer, and an anonymity that survives the receipt.
--
-- The order engine already knows how to take money — one payment path, one set
-- of books — so a vote purchase is an order like any other. What is different
-- is who may know about it.
--
-- A vote order carries **no seller**. Not because the pairing is unrecorded but
-- because `orders` is readable by the person it belongs to, and a buyer who can
-- read `seller_id` learns exactly what §23 promises they cannot. The pairing
-- lives on `marathon_vote_sales`, which has no read policy at all: both sides
-- see their own half through functions that return no counterpart.
--
-- The consequence is that the order records only the buyer's side — subtotal
-- plus the buyer's 12%. The seller's 12% is snapshotted on the sale row, which
-- is where a vote payout is reconciled from.

-- A vote order has a listing rather than a product, and no seller.
alter table public.orders drop constraint if exists orders_subject;
alter table public.orders add constraint orders_subject check (
  case purpose
    when 'subscription' then product_id is null and coin_package_id is null and reference_code is not null
    when 'jcoin' then product_id is null and coin_package_id is not null and reference_code is null
    when 'data_collection' then product_id is null and coin_package_id is null and reference_code is not null
    when 'marathon_votes' then product_id is null and coin_package_id is null and reference_code is not null
    else product_id is not null and coin_package_id is null
  end
);

alter table public.orders drop constraint if exists orders_seller;
alter table public.orders add constraint orders_seller check (
  (purpose in ('subscription', 'jcoin', 'data_collection', 'marathon_votes')) = (seller_id is null)
);

/**
 * A sale, and the escrow it sits in until the money lands.
 *
 * The votes leave the listing the moment somebody starts paying — otherwise two
 * buyers pay for the same vote and one of them is refunded a thing they thought
 * they owned. They reach the ledger only when the order is paid, and go back on
 * the market if it is not.
 */
create table if not exists public.marathon_vote_sales (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  listing_id uuid not null references public.marathon_vote_listings(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete restrict,
  kind public.marathon_vote_kind not null,
  quantity integer not null,

  -- The whole arithmetic, snapshotted. Changing the platform's cut tomorrow
  -- cannot restate what somebody agreed to today.
  unit_price integer not null,
  subtotal integer not null,
  buyer_fee_rate numeric(5,2) not null,
  buyer_fee integer not null,
  buyer_total integer not null,
  seller_fee_rate numeric(5,2) not null,
  seller_fee integer not null,
  seller_net integer not null,
  platform_revenue integer not null,

  status text not null default 'escrow',
  created_at timestamptz not null default now(),
  released_at timestamptz,
  refunded_at timestamptz,
  constraint marathon_sale_status check (status in ('escrow', 'released', 'refunded')),
  constraint marathon_sale_quantity check (quantity > 0 and unit_price > 0),
  constraint marathon_sale_parties check (buyer_id <> seller_id),
  constraint marathon_sale_arithmetic check (
    subtotal = unit_price * quantity
    and buyer_total = subtotal + buyer_fee
    and seller_net = subtotal - seller_fee
    and platform_revenue = buyer_fee + seller_fee
  )
);

create index if not exists marathon_sales_seller on public.marathon_vote_sales (seller_id, created_at desc);
create index if not exists marathon_sales_buyer on public.marathon_vote_sales (buyer_id, created_at desc);
create index if not exists marathon_sales_listing on public.marathon_vote_sales (listing_id);

-- No policies at all, on purpose. Every read goes through a function that
-- returns one side's half; a `select *` from either party would name the other.
alter table public.marathon_vote_sales enable row level security;

/**
 * Starting a purchase.
 *
 * Takes the votes off the market and creates the order in one transaction, so
 * two people cannot pay for the same lot. The client sends a listing and a
 * quantity; every figure on the order is computed here from the listing's own
 * price.
 */
create or replace function public.marathon_buy_votes(
  p_listing_id uuid,
  p_quantity integer default 1,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_campaign uuid;
  v_listing public.marathon_vote_listings%rowtype;
  v_quote jsonb;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
begin
  if v_buyer is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.assert_payment_allowed(p_platform, 'marketplace');

  v_campaign := public.marathon_market_campaign();
  if v_campaign is null then
    raise exception 'Ovozlar bozori hozircha yopiq.' using errcode = 'P0001';
  end if;

  -- Locked for the whole transaction: the stock check and the decrement have to
  -- be the same moment or they are not a check at all.
  select * into v_listing from public.marathon_vote_listings
   where id = p_listing_id for update;
  if not found or v_listing.status <> 'open' or v_listing.campaign_id <> v_campaign then
    raise exception 'Bu e''lon endi mavjud emas.' using errcode = 'P0001';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'O''z e''loningizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if v_quantity > v_listing.remaining then
    raise exception 'E''londa % ta ovoz qoldi.', v_listing.remaining using errcode = 'P0001';
  end if;

  -- An unfinished attempt at the same listing is the same purchase, not a
  -- second one — and it is already holding stock.
  v_existing := public.order_find_open(v_buyer, 'marathon_votes', null, null, p_listing_id::text);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  v_quote := public.marathon_vote_quote(v_listing.unit_price, v_quantity);

  insert into public.orders (
    user_id, purpose, reference_code, currency,
    subtotal, buyer_fee, total_amount,
    seller_fee, seller_net, platform_revenue,
    buyer_fee_rate, seller_fee_rate, metadata
  ) values (
    v_buyer, 'marathon_votes', p_listing_id::text, coalesce(v_quote ->> 'currency', 'UZS'),
    (v_quote ->> 'base_price')::integer,
    (v_quote ->> 'buyer_fee_amount')::integer,
    (v_quote ->> 'buyer_total')::integer,
    0, (v_quote ->> 'base_price')::integer, (v_quote ->> 'buyer_fee_amount')::integer,
    (v_quote ->> 'buyer_fee_rate')::numeric, 0,
    jsonb_build_object(
      'kind', v_listing.kind, 'quantity', v_quantity, 'unit_price', v_listing.unit_price,
      'platform', lower(btrim(coalesce(p_platform, 'unknown'))))
  )
  returning * into v_order;

  insert into public.marathon_vote_sales (
    campaign_id, listing_id, order_id, buyer_id, seller_id, kind, quantity,
    unit_price, subtotal, buyer_fee_rate, buyer_fee, buyer_total,
    seller_fee_rate, seller_fee, seller_net, platform_revenue
  ) values (
    v_campaign, v_listing.id, v_order.id, v_buyer, v_listing.seller_id, v_listing.kind, v_quantity,
    v_listing.unit_price, (v_quote ->> 'base_price')::integer,
    (v_quote ->> 'buyer_fee_rate')::numeric, (v_quote ->> 'buyer_fee_amount')::integer,
    (v_quote ->> 'buyer_total')::integer,
    (v_quote ->> 'seller_fee_rate')::numeric, (v_quote ->> 'seller_fee_amount')::integer,
    (v_quote ->> 'seller_net')::integer, (v_quote ->> 'platform_gross')::integer
  );

  update public.marathon_vote_listings
     set remaining = remaining - v_quantity,
         status = case when remaining - v_quantity = 0 then 'sold_out' else status end
   where id = v_listing.id;

  return public.order_summary(v_order) || jsonb_build_object('reused', false, 'kind', v_listing.kind, 'quantity', v_quantity);
end;
$$;

revoke all on function public.marathon_buy_votes(uuid, integer, text) from public;
grant execute on function public.marathon_buy_votes(uuid, integer, text) to authenticated;

/**
 * The votes arrive, and neither side is told who the other is.
 *
 * Called by fulfilment once the order is paid. The ledger rows carry the
 * seller as the voter — that is what they are, somebody else's allowance
 * transferred — and `source = 'marketplace'`, which is what keeps the direct
 * vote's identity notification away from this path.
 */
create or replace function public.marathon_fulfil_vote_sale(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.marathon_vote_sales%rowtype;
  v_index integer;
begin
  select * into v_sale from public.marathon_vote_sales where order_id = p_order_id for update;
  if not found then
    raise exception 'Bu buyurtma uchun ovoz savdosi topilmadi.' using errcode = 'P0002';
  end if;

  -- A retried callback is a normal event, not a second transfer.
  if v_sale.status = 'released' then
    return jsonb_build_object('sale_id', v_sale.id, 'already', true);
  end if;
  if v_sale.status = 'refunded' then
    raise exception 'Bu savdo bekor qilingan.' using errcode = 'P0001';
  end if;

  for v_index in 1 .. v_sale.quantity loop
    insert into public.marathon_vote_ledger (campaign_id, candidate_id, voter_id, kind, source)
    values (v_sale.campaign_id, v_sale.buyer_id, v_sale.seller_id, v_sale.kind, 'marketplace');
  end loop;

  update public.marathon_vote_sales
     set status = 'released', released_at = now()
   where id = v_sale.id;

  -- Both notifications are written here, and neither names anybody: §23 is a
  -- rule about what the app says, and the only way to keep it is to have no
  -- code path that could say otherwise.
  insert into public.notifications (user_id, kind, title, body, deep_link, payload)
  values (
    v_sale.buyer_id, 'marathon_vote',
    case when v_sale.kind = 'premium' then '⭐ Premium ovoz xaridi yakunlandi' else 'Ovoz xaridi yakunlandi' end,
    format('%s ta %s ovoz xaridingiz muvaffaqiyatli yakunlandi.',
           v_sale.quantity, case when v_sale.kind = 'premium' then 'Premium' else 'bepul' end),
    '/(app)/marathon',
    jsonb_build_object('kind', v_sale.kind, 'source', 'marketplace',
                       'quantity', v_sale.quantity, 'campaign_id', v_sale.campaign_id)
  );

  insert into public.notifications (user_id, kind, title, body, deep_link, payload)
  values (
    v_sale.seller_id, 'marathon_vote', 'Ovozingiz sotildi',
    format('Marketplace''dagi %s ta %s ovozingiz sotildi. Sizga %s so''m yoziladi.',
           v_sale.quantity, case when v_sale.kind = 'premium' then 'Premium' else 'bepul' end,
           v_sale.seller_net),
    '/(app)/marathon',
    jsonb_build_object('kind', v_sale.kind, 'source', 'marketplace',
                       'quantity', v_sale.quantity, 'seller_net', v_sale.seller_net)
  );

  return jsonb_build_object('sale_id', v_sale.id, 'quantity', v_sale.quantity, 'already', false);
end;
$$;

revoke all on function public.marathon_fulfil_vote_sale(uuid) from public;
grant execute on function public.marathon_fulfil_vote_sale(uuid) to service_role;

/**
 * An abandoned purchase puts the votes back.
 *
 * A trigger rather than a line in three functions: an order can end in
 * `cancelled`, `expired`, `failed` or `refunded`, and a vote held by a purchase
 * nobody completed would otherwise be off the market until the campaign ended.
 */
create or replace function public.marathon_release_vote_escrow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.marathon_vote_sales%rowtype;
begin
  if new.purpose <> 'marathon_votes' or new.status = old.status then
    return new;
  end if;
  if new.status not in ('cancelled'::public.order_status, 'expired'::public.order_status,
                        'failed'::public.order_status, 'refunded'::public.order_status) then
    return new;
  end if;

  select * into v_sale from public.marathon_vote_sales where order_id = new.id for update;
  if not found or v_sale.status <> 'escrow' then
    return new;
  end if;

  update public.marathon_vote_sales
     set status = 'refunded', refunded_at = now()
   where id = v_sale.id;

  -- Back on the market, unless the seller withdrew it in the meantime — a
  -- cancelled listing stays cancelled and the stock simply returns to nobody.
  update public.marathon_vote_listings
     set remaining = remaining + v_sale.quantity,
         status = case when status = 'sold_out' then 'open' else status end
   where id = v_sale.listing_id and status in ('open', 'sold_out');

  return new;
end;
$$;

drop trigger if exists marathon_vote_escrow_release on public.orders;
create trigger marathon_vote_escrow_release
  after update of status on public.orders
  for each row execute function public.marathon_release_vote_escrow();

/**
 * A seller's own sales, without a word about who bought them.
 *
 * The seller ledger of the design marketplace is bound to products and
 * purchases and cannot hold these; this is where a vote payout is reconciled
 * from until the settlement console learns about it.
 */
create or replace function public.marathon_my_vote_sales(p_limit integer default 50)
returns table (
  sale_id uuid,
  kind public.marathon_vote_kind,
  quantity integer,
  unit_price integer,
  seller_fee integer,
  seller_net integer,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.kind, s.quantity, s.unit_price, s.seller_fee, s.seller_net, s.status, s.created_at
    from public.marathon_vote_sales s
   where s.seller_id = auth.uid()
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.marathon_my_vote_sales(integer) from public;
grant execute on function public.marathon_my_vote_sales(integer) to authenticated;
