-- The choice at a milestone, written down where it cannot be taken back.
--
-- Reaching 1 000 votes and 300 Premium buys a candidate a decision: take 25%
-- of the contract now, or give that up and go on for 50%. Both halves are
-- irreversible, which is exactly why closing a modal cannot be either of them.
-- So the decision is a row, made by a function that checks the votes itself,
-- and a person who taps nothing is asked again next time.

create table if not exists public.marathon_milestone_decisions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marathon_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_position integer not null,
  decision text not null,
  -- What the ledger said at the moment of the decision. A reward is argued
  -- about months later, and "you had 1 004 votes when you claimed" is the
  -- answer; recounting a ledger that has moved on is not.
  total_votes_at integer not null,
  premium_votes_at integer not null,
  decided_at timestamptz not null default now(),
  constraint marathon_decision_kind check (decision in ('claim', 'continue')),
  constraint marathon_decision_once unique (campaign_id, user_id, tier_position)
);

create index if not exists marathon_decisions_person
  on public.marathon_milestone_decisions (campaign_id, user_id);

alter table public.marathon_milestone_decisions enable row level security;

-- A person reads their own decisions and nobody else's. There is no write
-- policy at all: the only way one is made is the function below, and the only
-- way one is undone is an administrator with the service role.
drop policy if exists marathon_decisions_read_own on public.marathon_milestone_decisions;
create policy marathon_decisions_read_own on public.marathon_milestone_decisions
  for select to authenticated
  using (user_id = (select auth.uid()));

/**
 * Taking a milestone, or giving it up for the next one.
 *
 * Everything is checked here rather than trusted from the screen: that the
 * marathon is running, that this person entered it, that the rung is real, that
 * both of its demands are actually met, and that no decision was already made —
 * for this rung or, in the case of a claim, for any of them, because claiming
 * ends the campaign for that candidate.
 *
 * "continue" refuses on the last rung. There is nothing beyond it to continue
 * toward, and a candidate who gave up the top reward for nothing would have
 * been let down by a screen, not by a rule.
 */
create or replace function public.marathon_decide_milestone(p_position integer, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campaign public.marathon_campaigns%rowtype;
  v_tier public.marathon_reward_tiers%rowtype;
  v_total integer;
  v_premium integer;
  v_claimed integer;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_decision not in ('claim', 'continue') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  select c.* into v_campaign
    from public.marathon_campaigns c
   where c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'student_marathon_enabled'), false)
   limit 1;
  if v_campaign.id is null then
    raise exception 'Marafon hozircha faol emas.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.marathon_participants
                  where campaign_id = v_campaign.id and user_id = v_user) then
    raise exception 'Siz marafon ishtirokchisi emassiz.' using errcode = 'P0001';
  end if;

  select t.* into v_tier
    from public.marathon_reward_tiers t
   where t.campaign_id = v_campaign.id and t.position = p_position;
  if v_tier.id is null then
    raise exception 'Bunday marra yo''q.' using errcode = '22023';
  end if;

  select count(*) filter (where true), count(*) filter (where kind = 'premium')
    into v_total, v_premium
    from public.marathon_vote_ledger
   where campaign_id = v_campaign.id and candidate_id = v_user;

  if v_total < v_tier.votes_required or v_premium < v_tier.premium_required then
    raise exception 'Bu marraga hali yetmadingiz (% / % ovoz, % / % Premium).',
      v_total, v_tier.votes_required, v_premium, v_tier.premium_required
      using errcode = 'P0001';
  end if;

  select d.tier_position into v_claimed
    from public.marathon_milestone_decisions d
   where d.campaign_id = v_campaign.id and d.user_id = v_user and d.decision = 'claim'
   limit 1;
  if v_claimed is not null then
    raise exception 'Siz allaqachon %-marra mukofotini olgansiz.', v_claimed using errcode = 'P0001';
  end if;

  if p_decision = 'continue'
     and not exists (select 1 from public.marathon_reward_tiers
                      where campaign_id = v_campaign.id and position > p_position) then
    raise exception 'Bu oxirgi marra — undan keyin davom etish mumkin emas.' using errcode = 'P0001';
  end if;

  insert into public.marathon_milestone_decisions (
    campaign_id, user_id, tier_position, decision, total_votes_at, premium_votes_at
  ) values (
    v_campaign.id, v_user, p_position, p_decision, v_total, v_premium
  )
  on conflict (campaign_id, user_id, tier_position) do nothing;

  if not found then
    raise exception 'Bu marra bo''yicha qaror allaqachon qabul qilingan.' using errcode = 'P0001';
  end if;

  -- Written in the same transaction as the decision: a person who gave up a
  -- reward has to be able to find the record of it afterwards, and a
  -- notification sent separately is one that can fail on its own.
  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    v_user,
    'marathon_milestone',
    case when p_decision = 'claim'
      then format('%s%% mukofot so''raldi', v_tier.reward_percent)
      else format('%s-marradan voz kechdingiz', p_position) end,
    case when p_decision = 'claim'
      then format('Kontrakt mukofotining %s%% qismi uchun so''rovingiz qabul qilindi.', v_tier.reward_percent)
      else format('%s%% mukofotdan voz kechib, keyingi marraga davom etdingiz.', v_tier.reward_percent) end,
    jsonb_build_object(
      'campaign_id', v_campaign.id, 'position', p_position, 'decision', p_decision,
      'reward_percent', v_tier.reward_percent, 'total_votes', v_total, 'premium_votes', v_premium
    )
  );

  return jsonb_build_object(
    'position', p_position, 'decision', p_decision, 'reward_percent', v_tier.reward_percent);
end;
$$;

revoke all on function public.marathon_decide_milestone(integer, text) from public;
grant execute on function public.marathon_decide_milestone(integer, text) to authenticated;

/**
 * The campaign answer now carries the decisions already made.
 *
 * The screen has to know three things to draw the milestone modal at the right
 * moment: which rungs are reached, which of them were answered, and whether a
 * reward was already claimed — because a claim ends the ladder. Sending them
 * with the campaign keeps the modal from appearing for a beat on a decision
 * that was made last week.
 */
create or replace function public.marathon_active_campaign()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with running as (
    select c.*
      from public.marathon_campaigns c
     where c.status = 'active'
       and coalesce((select value = 'true'::jsonb from public.app_settings
                      where key = 'student_marathon_enabled'), false)
     limit 1
  ),
  mine as (
    select
      count(v.id) as total_votes,
      count(v.id) filter (where v.kind = 'premium') as premium_votes,
      exists (select 1 from public.marathon_participants m, running r
               where m.campaign_id = r.id and m.user_id = auth.uid()) as joined
      from running r
      left join public.marathon_vote_ledger v
        on v.campaign_id = r.id and v.candidate_id = auth.uid()
  )
  select case when not exists (select 1 from running) then null else (
    select jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'description', r.description,
      'rules', r.rules,
      'poster_path', r.poster_path,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'server_now', now(),
      'contract_cap', r.contract_cap,
      'joined', (select joined from mine),
      'total_votes', (select total_votes from mine),
      'premium_votes', (select premium_votes from mine),
      'tiers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', t.position,
          'votes_required', t.votes_required,
          'premium_required', t.premium_required,
          'reward_percent', t.reward_percent
        ) order by t.position)
        from public.marathon_reward_tiers t where t.campaign_id = r.id
      ), '[]'::jsonb),
      'decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', d.tier_position,
          'decision', d.decision,
          'decided_at', d.decided_at
        ) order by d.tier_position)
        from public.marathon_milestone_decisions d
        where d.campaign_id = r.id and d.user_id = auth.uid()
      ), '[]'::jsonb)
    ) from running r
  ) end;
$$;

revoke all on function public.marathon_active_campaign() from public;
grant execute on function public.marathon_active_campaign() to authenticated;
