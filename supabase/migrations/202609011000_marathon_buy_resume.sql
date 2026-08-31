-- A buyer who taps twice is one buyer.
--
-- The first tap takes the lot off the market, so the second one found a listing
-- that was no longer open and was told it no longer existed — while that
-- buyer's own order for it sat there half paid. The order they already have is
-- now looked for before the listing's state is judged, because that order is
-- precisely what is holding the stock.
--
-- The rest of the function is unchanged from `202609010800`.

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
  if not found or v_listing.campaign_id <> v_campaign then
    raise exception 'Bu e''lon endi mavjud emas.' using errcode = 'P0001';
  end if;

  -- An unfinished attempt at the same listing is the same purchase, not a
  -- second one. Answered before the stock is looked at, because that attempt is
  -- what is holding the stock: a buyer who taps again while their card is being
  -- charged would otherwise be told the lot they are paying for is gone.
  v_existing := public.order_find_open(v_buyer, 'marathon_votes', null, null, p_listing_id::text);
  if v_existing.id is not null then
    return public.order_summary(v_existing) || jsonb_build_object('reused', true);
  end if;

  if v_listing.status <> 'open' then
    raise exception 'Bu e''lon endi mavjud emas.' using errcode = 'P0001';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'O''z e''loningizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if v_quantity > v_listing.remaining then
    raise exception 'E''londa % ta ovoz qoldi.', v_listing.remaining using errcode = 'P0001';
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
