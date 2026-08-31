-- Two things an operator needs and no user may have: which votes look bought,
-- and who is owed money.
--
-- Neither of these punishes anybody. Detection that acts on its own is how a
-- student loses a contract because thirty friends signed up in the same lecture
-- and voted in the same hour — which is indistinguishable, in data, from fraud.
-- So this measures, names what it measured, and stops. The decision is a
-- person's.

alter table public.marathon_vote_sales
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by uuid references auth.users(id) on delete set null;

create index if not exists marathon_sales_unsettled
  on public.marathon_vote_sales (seller_id)
  where status = 'released' and settled_at is null;

/**
 * What a candidate's votes look like, in the four ways they can look wrong.
 *
 * Every signal is a count, not a verdict:
 *
 *   fresh_voters   — votes from accounts created after the campaign began. A
 *                    real campaign brings real sign-ups, so this is high for
 *                    honest candidates too. It matters next to the others.
 *   burst          — the most votes received inside any ten-minute window.
 *                    Organic support arrives across days; a bought block
 *                    arrives while somebody is at a keyboard.
 *   bought_share   — how much of the total came through the marketplace.
 *   concentration  — the share of bought votes that came from the single
 *                    seller who supplied the most. One seller supplying a
 *                    candidate's whole ladder is one person with many accounts.
 *
 * Admin only, and it names voters to nobody: the counts are aggregates, so the
 * console can tell an operator *that* something is concentrated without handing
 * them a list of who voted for whom.
 */
create or replace function public.admin_marathon_fraud(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with campaign as (
    select c.id, c.starts_at from public.marathon_campaigns c where c.id = p_campaign_id
  ),
  votes as (
    select v.candidate_id, v.voter_id, v.kind, v.source, v.created_at,
           u.created_at as voter_since
      from public.marathon_vote_ledger v
      join campaign c on c.id = v.campaign_id
      left join auth.users u on u.id = v.voter_id
  ),
  -- The most votes that landed inside any ten-minute window. Organic support
  -- arrives across days; a bought block arrives while somebody is at a keyboard.
  windowed as (
    select candidate_id,
           count(*) over (
             partition by candidate_id
             order by created_at
             range between interval '10 minutes' preceding and current row
           ) as hits
      from votes
  ),
  bursts as (
    select candidate_id, max(hits) as burst from windowed group by candidate_id
  ),
  -- How much of a candidate's bought votes came from the single seller who
  -- supplied the most of them. One seller supplying a whole ladder is one
  -- person with several accounts.
  sellers as (
    select candidate_id, voter_id, count(*) as supplied
      from votes where source = 'marketplace' and voter_id is not null
     group by candidate_id, voter_id
  ),
  top_seller as (
    select candidate_id, max(supplied) as most from sellers group by candidate_id
  ),
  totals as (
    select
      v.candidate_id,
      count(*) as total,
      count(*) filter (where v.kind = 'premium') as premium,
      count(*) filter (where v.source = 'direct') as direct,
      count(*) filter (where v.source = 'marketplace') as bought,
      count(distinct v.voter_id) as distinct_voters,
      count(*) filter (where v.voter_since >= (select starts_at from campaign)) as fresh_voters
      from votes v
     group by v.candidate_id
  )
  select case when not public.is_admin() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'candidate_id', t.candidate_id,
      'username', p.username,
      'full_name', p.full_name,
      'total', t.total,
      'premium', t.premium,
      'direct', t.direct,
      'bought', t.bought,
      'distinct_voters', t.distinct_voters,
      'fresh_voters', t.fresh_voters,
      'burst', coalesce(b.burst, 0),
      'top_seller_share', case when t.bought = 0 then 0
        else round(100.0 * coalesce(s.most, 0) / t.bought) end
    ) order by t.total desc)
      from totals t
      left join public.profiles p on p.id = t.candidate_id
      left join bursts b on b.candidate_id = t.candidate_id
      left join top_seller s on s.candidate_id = t.candidate_id
  ), '[]'::jsonb) end;
$$;

revoke all on function public.admin_marathon_fraud(uuid) from public;
grant execute on function public.admin_marathon_fraud(uuid) to authenticated;

/**
 * Who is owed what for the votes they sold.
 *
 * The design marketplace's settlement tables are bound to products and
 * purchases and cannot hold a vote sale, so this is where a marathon payout is
 * reconciled from: one row per seller, the money already snapshotted on the
 * sales themselves.
 */
create or replace function public.admin_marathon_payouts(p_campaign_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select
      s.seller_id,
      count(*) as sales,
      sum(s.quantity) as votes,
      sum(s.subtotal) as gross,
      sum(s.seller_fee) as fee,
      sum(s.seller_net) as net
      from public.marathon_vote_sales s
     where s.status = 'released' and s.settled_at is null
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
     group by s.seller_id
  )
  select case when not public.is_admin() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'seller_id', t.seller_id,
      'username', p.username,
      'full_name', p.full_name,
      'sales', t.sales,
      'votes', t.votes,
      'gross', t.gross,
      'fee', t.fee,
      'net', t.net
    ) order by t.net desc)
      from totals t
      left join public.profiles p on p.id = t.seller_id
  ), '[]'::jsonb) end;
$$;

revoke all on function public.admin_marathon_payouts(uuid) from public;
grant execute on function public.admin_marathon_payouts(uuid) to authenticated;

/**
 * Marking a seller paid.
 *
 * Stamps the sales rather than deleting them, and never touches the ledger: the
 * votes moved when the buyer paid, and money leaving the platform afterwards is
 * a separate fact about the same rows. Audited, because it is the moment
 * somebody says a payment was made outside the system.
 */
create or replace function public.admin_settle_marathon_sales(
  p_seller_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_net bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(seller_net), 0) into v_count, v_net
    from public.marathon_vote_sales
   where seller_id = p_seller_id and status = 'released' and settled_at is null;

  if v_count = 0 then
    raise exception 'Bu sotuvchida to''lanmagan savdo yo''q.' using errcode = 'P0001';
  end if;

  update public.marathon_vote_sales
     set settled_at = now(), settled_by = v_actor
   where seller_id = p_seller_id and status = 'released' and settled_at is null;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (v_actor, 'marathon.sales_settled', 'auth.users', p_seller_id::text, p_reason,
          jsonb_build_object('sales', v_count, 'net', v_net));

  return jsonb_build_object('seller_id', p_seller_id, 'sales', v_count, 'net', v_net);
end;
$$;

revoke all on function public.admin_settle_marathon_sales(uuid, text) from public;
grant execute on function public.admin_settle_marathon_sales(uuid, text) to authenticated;
