-- The marathon's own tables. Additive, and inert while the flag is off.
--
-- An administrator can build a whole campaign — poster, rules, dates, reward
-- ladder — months before anybody sees it, which is what §30 asks for and what
-- these tables are shaped around: a campaign is `draft` until somebody decides
-- otherwise, and only one may be `active` at a time.

do $$ begin
  create type public.marathon_status as enum ('draft', 'active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.marathon_vote_kind as enum ('free', 'premium');
exception when duplicate_object then null; end $$;

/**
 * Where a vote came from, because it decides what a notification may say.
 *
 * A vote somebody cast carries their name to the person who received it. A
 * vote that arrived through the marketplace carries nothing: the whole point
 * of that market is that neither side knows the other, and a notification is
 * the easiest place to leak it by accident.
 */
do $$ begin
  create type public.marathon_vote_source as enum ('direct', 'marketplace');
exception when duplicate_object then null; end $$;

create table if not exists public.marathon_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  rules text not null default '',
  -- 2.35:1, enforced where it is uploaded rather than here: a column cannot
  -- measure an image.
  poster_path text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  contract_cap bigint not null default 10000000,
  status public.marathon_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marathon_campaign_window check (ends_at > starts_at),
  constraint marathon_campaign_cap check (contract_cap > 0)
);

-- One campaign runs at a time. Two would make "the active campaign" a question
-- with two answers, and every count below depends on there being one.
create unique index if not exists marathon_single_active
  on public.marathon_campaigns ((status))
  where status = 'active';

create table if not exists public.marathon_reward_tiers (
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  position smallint not null,
  votes_required integer not null,
  premium_required integer not null,
  reward_percent smallint not null,
  primary key (campaign_id, position),
  constraint marathon_tier_votes check (votes_required > 0 and premium_required >= 0),
  constraint marathon_tier_percent check (reward_percent between 1 and 100)
);

create table if not exists public.marathon_participants (
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

/**
 * Every vote ever cast, and none of them ever changed.
 *
 * Counts are derived from this and stored nowhere else: a running total that
 * can be written to is a total that can disagree with the votes behind it, and
 * the first time it does, nobody can tell which is right. The trigger below
 * refuses updates and deletes outright.
 */
create table if not exists public.marathon_vote_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  voter_id uuid references auth.users(id) on delete set null,
  kind public.marathon_vote_kind not null,
  source public.marathon_vote_source not null default 'direct',
  created_at timestamptz not null default now(),
  constraint marathon_no_self_vote check (voter_id is null or voter_id <> candidate_id)
);

-- One free and one premium vote each, cast directly. A marketplace vote is a
-- transfer of somebody else's allowance and is not bound by this.
create unique index if not exists marathon_one_direct_vote_per_kind
  on public.marathon_vote_ledger (campaign_id, voter_id, kind)
  where source = 'direct' and voter_id is not null;

create index if not exists marathon_ledger_candidate
  on public.marathon_vote_ledger (campaign_id, candidate_id, kind);

create or replace function public.marathon_ledger_is_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'marathon vote ledger is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists marathon_ledger_no_change on public.marathon_vote_ledger;
create trigger marathon_ledger_no_change
  before update or delete on public.marathon_vote_ledger
  for each row execute function public.marathon_ledger_is_immutable();

/* ------------------------------------------------------------------- RLS */

alter table public.marathon_campaigns enable row level security;
alter table public.marathon_reward_tiers enable row level security;
alter table public.marathon_participants enable row level security;
alter table public.marathon_vote_ledger enable row level security;

-- A campaign is visible when it is running, and to an administrator always.
drop policy if exists marathon_campaigns_read on public.marathon_campaigns;
create policy marathon_campaigns_read on public.marathon_campaigns
  for select to authenticated
  using (status = 'active' or (select public.is_admin()));

drop policy if exists marathon_tiers_read on public.marathon_reward_tiers;
create policy marathon_tiers_read on public.marathon_reward_tiers
  for select to authenticated
  using (exists (
    select 1 from public.marathon_campaigns c
     where c.id = campaign_id and (c.status = 'active' or (select public.is_admin()))
  ));

drop policy if exists marathon_participants_read on public.marathon_participants;
create policy marathon_participants_read on public.marathon_participants
  for select to authenticated
  using (exists (
    select 1 from public.marathon_campaigns c
     where c.id = campaign_id and (c.status = 'active' or (select public.is_admin()))
  ));

/**
 * Nobody reads the ledger directly.
 *
 * A person may see their own votes; everything else about it — who voted for
 * whom, and through which route — is answered by the functions below, which
 * decide what may be said. Reading the rows would tell a candidate exactly who
 * bought votes for them, which the marketplace exists to prevent.
 */
drop policy if exists marathon_ledger_own on public.marathon_vote_ledger;
create policy marathon_ledger_own on public.marathon_vote_ledger
  for select to authenticated
  using (voter_id = (select auth.uid()));

/* ------------------------------------------------------------ the search */

/**
 * Participants, found by username.
 *
 * Only people who joined the running campaign: an ordinary account is not a
 * candidate and must not appear as one. The counts come from the ledger every
 * time rather than from a column, so a result cannot be stale in the one place
 * a voter is deciding.
 */
create or replace function public.marathon_search_candidates(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  total_votes bigint,
  premium_votes bigint
)
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
  needle as (
    select nullif(trim(leading '@' from coalesce(p_query, '')), '') as term
  )
  select
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    count(v.id) filter (where v.id is not null) as total_votes,
    count(v.id) filter (where v.kind = 'premium') as premium_votes
  from public.marathon_participants m
  join running r on r.id = m.campaign_id
  join public.profiles p on p.id = m.user_id
  left join public.marathon_vote_ledger v
    on v.campaign_id = m.campaign_id and v.candidate_id = m.user_id
  cross join needle n
  where n.term is not null
    and (p.username ilike n.term || '%' or p.full_name ilike '%' || n.term || '%')
  group by p.id, p.username, p.full_name, p.avatar_url
  order by count(v.id) desc, p.username
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.marathon_search_candidates(text, integer, integer) from public;
grant execute on function public.marathon_search_candidates(text, integer, integer) to authenticated;

comment on function public.marathon_search_candidates(text, integer, integer) is
  'Finds candidates in the running campaign by username or name. Returns nothing while the marathon is switched off or no campaign is active.';
