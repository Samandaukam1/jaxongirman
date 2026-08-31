-- The vote marketplace: what is for sale, at what price, and what that costs
-- the person selling it.
--
-- Four rules the schema enforces rather than documents:
--
--   1. Nobody sells a vote they do not hold. The allowance is one free and one
--      premium per campaign, and a listing is checked against the ledger — not
--      against a number the client sent.
--
--   2. A listed vote is locked. It cannot also be cast: `marathon_my_votes`
--      subtracts it and `marathon_cast_vote` refuses it, so the same vote
--      cannot be sold and given away in the same afternoon.
--
--   3. The seller is not readable. Anonymity is not a column the browse screen
--      politely omits — there is no row-level read for anybody but the seller,
--      and the market is served by a function that never selects `seller_id`.
--
--   4. Prices have a floor, and the floor moves. A campaign sets a base, and
--      the market raises it: a race to the bottom on a vote that is worth real
--      money to somebody is how this turns into a way to buy a contract for
--      nothing.

-- The marketplace has its own switch, under the marathon's.
insert into public.app_settings (key, value, description)
values ('marathon.vote_marketplace_enabled', 'false'::jsonb,
        'Marafon ovozlari bozori ochiqmi (student_marathon_enabled ham yoqilgan bo''lishi shart).')
on conflict (key) do nothing;

-- 12% from each side, as its own scope. The design marketplace's 20/20 is a
-- different market with different economics and must not move because this one
-- did.
insert into public.commission_config (scope, buyer_fee_rate, seller_fee_rate)
values ('marathon_votes', 12.00, 12.00)
on conflict (scope) do nothing;

-- What an administrator sets as the floor, per campaign and per kind. A premium
-- vote is worth more than a free one by construction, so one number for both
-- would price one of them wrong.
alter table public.marathon_campaigns
  add column if not exists min_free_price integer not null default 5000,
  add column if not exists min_premium_price integer not null default 15000;

alter table public.marathon_campaigns
  drop constraint if exists marathon_campaign_min_prices;
alter table public.marathon_campaigns
  add constraint marathon_campaign_min_prices
  check (min_free_price > 0 and min_premium_price > 0);

create table if not exists public.marathon_vote_listings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  kind public.marathon_vote_kind not null,
  quantity integer not null,
  /** What is still for sale. A partly sold lot stays open at what is left. */
  remaining integer not null,
  /** Whole som, like every other price in this application. */
  unit_price integer not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marathon_listing_status check (status in ('open', 'sold_out', 'cancelled')),
  constraint marathon_listing_quantity check (quantity > 0 and remaining >= 0 and remaining <= quantity),
  constraint marathon_listing_price check (unit_price > 0),
  constraint marathon_listing_open_has_stock check (status <> 'open' or remaining > 0)
);

create trigger marathon_vote_listings_set_updated_at
  before update on public.marathon_vote_listings
  for each row execute function public.set_updated_at();

-- One open lot per person per kind. Two would let somebody sell the same vote
-- twice by listing it again while the first is still up.
create unique index if not exists marathon_listing_one_open
  on public.marathon_vote_listings (campaign_id, seller_id, kind)
  where status = 'open';

create index if not exists marathon_listing_market
  on public.marathon_vote_listings (campaign_id, kind, unit_price)
  where status = 'open';

alter table public.marathon_vote_listings enable row level security;

-- A seller reads their own listings and nobody else's. There is deliberately no
-- policy that lets a buyer read a row: buyers see the market through
-- `marathon_vote_market()`, which cannot return a seller.
drop policy if exists marathon_listings_read_own on public.marathon_vote_listings;
create policy marathon_listings_read_own on public.marathon_vote_listings
  for select to authenticated
  using (seller_id = (select auth.uid()));

/**
 * The floor a price has to clear, which the market itself raises.
 *
 * The campaign's configured base is the floor of the floor. Above it, the last
 * ten sales of that kind set the level: four fifths of what people have
 * actually been paying. That keeps a seller from undercutting the market into
 * the ground — a vote that decides a ten-million-som contract cannot be worth
 * two thousand — while still letting the price fall when demand does.
 */
create or replace function public.marathon_min_vote_price(
  p_campaign_id uuid,
  p_kind public.marathon_vote_kind
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select s.unit_price
      from public.marathon_vote_listings s
     where s.campaign_id = p_campaign_id and s.kind = p_kind and s.status = 'sold_out'
     order by s.updated_at desc
     limit 10
  )
  select greatest(
    case p_kind
      when 'free' then c.min_free_price
      else c.min_premium_price
    end,
    coalesce((select round(avg(unit_price) * 0.8)::integer from recent), 0)
  )
    from public.marathon_campaigns c
   where c.id = p_campaign_id;
$$;

revoke all on function public.marathon_min_vote_price(uuid, public.marathon_vote_kind) from public;
grant execute on function public.marathon_min_vote_price(uuid, public.marathon_vote_kind) to authenticated;

/**
 * What a lot costs the buyer and leaves the seller.
 *
 * Reads the same `marketplace_quote` every other price in the application goes
 * through, under this market's own scope, so nobody computes a fee in a client
 * and the two markets cannot drift apart in the rounding.
 */
create or replace function public.marathon_vote_quote(p_unit_price integer, p_quantity integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quote jsonb;
begin
  if p_unit_price is null or p_unit_price <= 0 or p_quantity is null or p_quantity <= 0 then
    raise exception 'narx va miqdor musbat bo''lishi kerak' using errcode = '22023';
  end if;
  v_quote := public.marketplace_quote(p_unit_price * p_quantity, 'marathon_votes');
  return v_quote || jsonb_build_object('unit_price', p_unit_price, 'quantity', p_quantity);
end;
$$;

revoke all on function public.marathon_vote_quote(integer, integer) from public;
grant execute on function public.marathon_vote_quote(integer, integer) to authenticated;

/**
 * Whether the market is open at all.
 *
 * Two switches and a campaign: the marathon's own flag, the marketplace's, and
 * something running to trade in. Any one of them missing closes it.
 */
create or replace function public.marathon_market_campaign()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.marathon_campaigns c
   where c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'student_marathon_enabled'), false)
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'marathon.vote_marketplace_enabled'), false)
   limit 1;
$$;

revoke all on function public.marathon_market_campaign() from public;
grant execute on function public.marathon_market_campaign() to authenticated;

/**
 * Putting a vote up for sale.
 *
 * Everything is checked here: that the market is open, that this person holds
 * the vote, that it is not already listed, that the price clears the floor.
 * The client sends a price and a quantity and nothing else — no fee, no total,
 * no claim about what it holds.
 */
create or replace function public.marathon_list_votes(
  p_kind public.marathon_vote_kind,
  p_quantity integer,
  p_unit_price integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_campaign uuid;
  v_available integer;
  v_floor integer;
  v_listing uuid;
begin
  if v_seller is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  v_campaign := public.marathon_market_campaign();
  if v_campaign is null then
    raise exception 'Ovozlar bozori hozircha yopiq.' using errcode = 'P0001';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Miqdor kamida 1 bo''lishi kerak.' using errcode = '22023';
  end if;

  -- The allowance minus what was already spent or already listed. Read here
  -- rather than taken from the caller, because a vote is worth money and a
  -- number in a request is worth nothing.
  select case when exists (
      select 1 from public.marathon_vote_ledger
       where campaign_id = v_campaign and voter_id = v_seller
         and kind = p_kind and source = 'direct')
    then 0 else 1 end
    - coalesce((select sum(remaining) from public.marathon_vote_listings
                 where campaign_id = v_campaign and seller_id = v_seller
                   and kind = p_kind and status = 'open'), 0)
    into v_available;

  if v_available < p_quantity then
    raise exception 'Sizda sotish uchun % ta % ovoz yo''q (mavjud: %).',
      p_quantity, p_kind, greatest(v_available, 0) using errcode = 'P0001';
  end if;

  v_floor := public.marathon_min_vote_price(v_campaign, p_kind);
  if p_unit_price is null or p_unit_price < v_floor then
    raise exception 'Narx ushbu marafon uchun ruxsat etilgan minimal bozor narxidan past (% so''m).',
      v_floor using errcode = 'P0001', detail = 'below_minimum';
  end if;

  insert into public.marathon_vote_listings (campaign_id, seller_id, kind, quantity, remaining, unit_price)
  values (v_campaign, v_seller, p_kind, p_quantity, p_quantity, p_unit_price)
  returning id into v_listing;

  return jsonb_build_object(
    'listing_id', v_listing,
    'kind', p_kind,
    'quantity', p_quantity,
    'unit_price', p_unit_price,
    'quote', public.marathon_vote_quote(p_unit_price, p_quantity));
end;
$$;

revoke all on function public.marathon_list_votes(public.marathon_vote_kind, integer, integer) from public;
grant execute on function public.marathon_list_votes(public.marathon_vote_kind, integer, integer) to authenticated;

/**
 * Taking a lot back down.
 *
 * Only your own, only while it is open, and only what has not sold — a sold
 * vote has already moved and there is nothing left to withdraw.
 */
create or replace function public.marathon_cancel_vote_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_row public.marathon_vote_listings%rowtype;
begin
  if v_seller is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.marathon_vote_listings
     set status = 'cancelled', remaining = 0
   where id = p_listing_id and seller_id = v_seller and status = 'open'
  returning * into v_row;

  if not found then
    raise exception 'Bu e''lonni bekor qilib bo''lmaydi.' using errcode = 'P0001';
  end if;

  return jsonb_build_object('listing_id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function public.marathon_cancel_vote_listing(uuid) from public;
grant execute on function public.marathon_cancel_vote_listing(uuid) to authenticated;

/**
 * The market, as a buyer sees it.
 *
 * No seller, no username, no avatar, no count of how many lots one person has
 * up — an anonymous marketplace is anonymous in what it returns, not in what
 * the screen chooses to draw. Cheapest first, because that is the only order a
 * buyer wants when every lot is identical.
 */
create or replace function public.marathon_vote_market(
  p_kind public.marathon_vote_kind default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  listing_id uuid,
  kind public.marathon_vote_kind,
  remaining integer,
  unit_price integer,
  buyer_fee integer,
  buyer_total integer,
  is_mine boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.kind,
    l.remaining,
    l.unit_price,
    (public.marathon_vote_quote(l.unit_price, l.remaining) ->> 'buyer_fee_amount')::integer,
    (public.marathon_vote_quote(l.unit_price, l.remaining) ->> 'buyer_total')::integer,
    l.seller_id = auth.uid()
    from public.marathon_vote_listings l
   where l.campaign_id = public.marathon_market_campaign()
     and l.status = 'open'
     and (p_kind is null or l.kind = p_kind)
   order by l.unit_price asc, l.created_at asc
   limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.marathon_vote_market(public.marathon_vote_kind, integer, integer) from public;
grant execute on function public.marathon_vote_market(public.marathon_vote_kind, integer, integer) to authenticated;

/**
 * The wallet, now that a vote can be locked in a listing.
 *
 * A listed vote is still yours and is no longer available: `available` is what
 * you can cast, `listed` is what is on the market. Two numbers rather than one,
 * because a person who sees "0 ta mavjud" with no explanation concludes the app
 * lost their vote.
 */
create or replace function public.marathon_my_votes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with running as (
    select c.id
      from public.marathon_campaigns c
     where c.status = 'active'
       and coalesce((select value = 'true'::jsonb from public.app_settings
                      where key = 'student_marathon_enabled'), false)
     limit 1
  ),
  spent as (
    select v.kind
      from public.marathon_vote_ledger v
      join running r on r.id = v.campaign_id
     where v.voter_id = auth.uid() and v.source = 'direct'
  ),
  listed as (
    select l.kind, sum(l.remaining) as held
      from public.marathon_vote_listings l
      join running r on r.id = l.campaign_id
     where l.seller_id = auth.uid() and l.status = 'open'
     group by l.kind
  )
  select jsonb_build_object(
    'campaign_id', (select id from running),
    'free_available', greatest(0,
      case when exists (select 1 from running)
        and not exists (select 1 from spent where kind = 'free') then 1 else 0 end
      - coalesce((select held from listed where kind = 'free'), 0)),
    'premium_available', greatest(0,
      case when exists (select 1 from running)
        and not exists (select 1 from spent where kind = 'premium') then 1 else 0 end
      - coalesce((select held from listed where kind = 'premium'), 0)),
    'free_listed', coalesce((select held from listed where kind = 'free'), 0),
    'premium_listed', coalesce((select held from listed where kind = 'premium'), 0)
  );
$$;

revoke all on function public.marathon_my_votes() from public;
grant execute on function public.marathon_my_votes() to authenticated;
