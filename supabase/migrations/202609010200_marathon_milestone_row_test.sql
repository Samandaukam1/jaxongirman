-- A reward tier is keyed by (campaign, position) and has no `id`.
--
-- The first version of `marathon_decide_milestone` tested `v_tier.id is null`
-- to mean "no such rung", which is not a field on that record and therefore
-- not a test at all: every call raised `record "v_tier" has no field "id"`,
-- and the only decisions that appeared to work were the ones that were refused
-- before reaching it. `found` is what the lookup actually sets.

create or replace function public.marathon_decide_milestone(p_position integer, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campaign_id uuid;
  v_tier public.marathon_reward_tiers%rowtype;
  v_total integer;
  v_premium integer;
  v_claimed integer;
  v_inserted integer;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_decision not in ('claim', 'continue') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  select c.id into v_campaign_id
    from public.marathon_campaigns c
   where c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'student_marathon_enabled'), false)
   limit 1;
  if v_campaign_id is null then
    raise exception 'Marafon hozircha faol emas.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.marathon_participants
                  where campaign_id = v_campaign_id and user_id = v_user) then
    raise exception 'Siz marafon ishtirokchisi emassiz.' using errcode = 'P0001';
  end if;

  select t.* into v_tier
    from public.marathon_reward_tiers t
   where t.campaign_id = v_campaign_id and t.position = p_position;
  if not found then
    raise exception 'Bunday marra yo''q.' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where kind = 'premium')
    into v_total, v_premium
    from public.marathon_vote_ledger
   where campaign_id = v_campaign_id and candidate_id = v_user;

  if v_total < v_tier.votes_required or v_premium < v_tier.premium_required then
    raise exception 'Bu marraga hali yetmadingiz (% / % ovoz, % / % Premium).',
      v_total, v_tier.votes_required, v_premium, v_tier.premium_required
      using errcode = 'P0001';
  end if;

  select d.tier_position into v_claimed
    from public.marathon_milestone_decisions d
   where d.campaign_id = v_campaign_id and d.user_id = v_user and d.decision = 'claim'
   limit 1;
  if v_claimed is not null then
    raise exception 'Siz allaqachon %-marra mukofotini olgansiz.', v_claimed using errcode = 'P0001';
  end if;

  if p_decision = 'continue'
     and not exists (select 1 from public.marathon_reward_tiers
                      where campaign_id = v_campaign_id and position > p_position) then
    raise exception 'Bu oxirgi marra — undan keyin davom etish mumkin emas.' using errcode = 'P0001';
  end if;

  insert into public.marathon_milestone_decisions (
    campaign_id, user_id, tier_position, decision, total_votes_at, premium_votes_at
  ) values (
    v_campaign_id, v_user, p_position, p_decision, v_total, v_premium
  )
  on conflict (campaign_id, user_id, tier_position) do nothing;

  -- `found` after an INSERT ... ON CONFLICT DO NOTHING is true whether or not a
  -- row was written, so the count is what says whether this decision is new.
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'Bu marra bo''yicha qaror allaqachon qabul qilingan.' using errcode = 'P0001';
  end if;

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
      'campaign_id', v_campaign_id, 'position', p_position, 'decision', p_decision,
      'reward_percent', v_tier.reward_percent, 'total_votes', v_total, 'premium_votes', v_premium
    )
  );

  return jsonb_build_object(
    'position', p_position, 'decision', p_decision, 'reward_percent', v_tier.reward_percent);
end;
$$;

revoke all on function public.marathon_decide_milestone(integer, text) from public;
grant execute on function public.marathon_decide_milestone(integer, text) to authenticated;
