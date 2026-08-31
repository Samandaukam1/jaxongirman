-- A listed vote cannot also be given away.
--
-- The allowance is one free and one premium vote per campaign, so a vote put up
-- for sale and a vote cast are the same vote. `marathon_my_votes` already
-- subtracts what is listed; this is the other half — the write itself refuses,
-- so a screen that has not refreshed cannot spend something that is spoken for.
--
-- The rest of the function is unchanged from `202608311800`.

create or replace function public.marathon_cast_vote(
  p_candidate_id uuid,
  p_kind public.marathon_vote_kind
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voter uuid := auth.uid();
  v_campaign uuid;
  v_vote uuid;
  v_voter_name text;
  v_voter_username text;
  v_total bigint;
  v_premium bigint;
begin
  if v_voter is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select c.id into v_campaign
    from public.marathon_campaigns c
   where c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'student_marathon_enabled'), false)
   limit 1;

  if v_campaign is null then
    raise exception 'Marafon hozircha faol emas.' using errcode = 'P0001';
  end if;

  if p_candidate_id = v_voter then
    raise exception 'O''zingizga ovoz bera olmaysiz.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.marathon_participants m
     where m.campaign_id = v_campaign and m.user_id = p_candidate_id
  ) then
    raise exception 'Bu foydalanuvchi marafon ishtirokchisi emas.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.marathon_vote_ledger v
     where v.campaign_id = v_campaign and v.voter_id = v_voter
       and v.kind = p_kind and v.source = 'direct'
  ) then
    raise exception 'Bu ovozni allaqachon berdingiz.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.marathon_vote_listings l
     where l.campaign_id = v_campaign and l.seller_id = v_voter
       and l.kind = p_kind and l.status = 'open' and l.remaining > 0
  ) then
    raise exception 'Bu ovoz bozorda sotuvda turibdi. Avval e''lonni bekor qiling.'
      using errcode = 'P0001', detail = 'vote_listed';
  end if;

  insert into public.marathon_vote_ledger (campaign_id, candidate_id, voter_id, kind, source)
  values (v_campaign, p_candidate_id, v_voter, p_kind, 'direct')
  returning id into v_vote;

  select p.full_name, p.username into v_voter_name, v_voter_username
    from public.profiles p where p.id = v_voter;

  select count(*), count(*) filter (where kind = 'premium')
    into v_total, v_premium
    from public.marathon_vote_ledger
   where campaign_id = v_campaign and candidate_id = p_candidate_id;

  /**
   * A direct vote carries the name of whoever cast it.
   *
   * This is the one place identity is shown on purpose: somebody chose to
   * support this person and the person should know who. A vote that arrived
   * through the marketplace never comes through here, and its notification —
   * written where that transfer happens — says only that votes arrived.
   */
  insert into public.notifications (user_id, kind, title, body, entity_id, deep_link, payload)
  values (
    p_candidate_id,
    'marathon_vote',
    case when p_kind = 'premium' then '⭐ Sizga Premium ovoz berildi' else '🎉 Sizga yangi ovoz berildi' end,
    coalesce(v_voter_name, 'Foydalanuvchi')
      || coalesce(' (@' || v_voter_username || ')', '')
      || case when p_kind = 'premium' then ' sizga Premium ovoz berdi.' else ' sizga ovoz berdi.' end,
    v_vote,
    '/(app)/marathon',
    jsonb_build_object('kind', p_kind, 'source', 'direct', 'campaign_id', v_campaign)
  );

  return jsonb_build_object(
    'vote_id', v_vote,
    'kind', p_kind,
    'candidate_total', v_total,
    'candidate_premium', v_premium
  );
end;
$$;

revoke all on function public.marathon_cast_vote(uuid, public.marathon_vote_kind) from public;
grant execute on function public.marathon_cast_vote(uuid, public.marathon_vote_kind) to authenticated;

