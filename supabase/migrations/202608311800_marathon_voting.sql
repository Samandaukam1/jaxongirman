-- Casting a vote, and telling the person who received it.
--
-- One function, because every rule that matters has to hold in the same
-- transaction as the write: the marathon is on, a campaign is running, the
-- candidate entered it, the voter is not the candidate, and this particular
-- vote has not already been cast. Checking any of those in an edge function
-- leaves a gap between the check and the insert, and a gap is where a second
-- tap gets in.

do $$ begin
  alter type public.notification_kind add value if not exists 'marathon_vote';
exception when others then null; end $$;

/**
 * What a person still has to give.
 *
 * Derived, like everything else here: the allowance is one free and one
 * premium vote, and what is left is that minus what the ledger says was spent.
 * A stored balance would be a second answer to a question the ledger already
 * answers.
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
  )
  select jsonb_build_object(
    'campaign_id', (select id from running),
    'free_available', case when exists (select 1 from running)
      and not exists (select 1 from spent where kind = 'free') then 1 else 0 end,
    'premium_available', case when exists (select 1 from running)
      and not exists (select 1 from spent where kind = 'premium') then 1 else 0 end
  );
$$;

revoke all on function public.marathon_my_votes() from public;
grant execute on function public.marathon_my_votes() to authenticated;

/**
 * One vote, cast once.
 *
 * The unique index on the ledger is what actually prevents a double vote; this
 * catches it first so the person gets a sentence rather than a constraint
 * name. Both are needed — the message is for them, the index is for the second
 * tap that arrives while the first is still in flight.
 *
 * The notification is written in the same transaction, because a vote that
 * counted and a notification that did not is a candidate who never learns, and
 * a notification without the vote is worse.
 */
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

comment on function public.marathon_cast_vote(uuid, public.marathon_vote_kind) is
  'Casts one direct vote and notifies the candidate, in one transaction. Every rule is checked here because a check outside the write leaves a gap a second tap fits through.';
