-- The campaign answer carries the server's own clock.
--
-- A countdown drawn against `Date.now()` is a countdown a wrong phone can end
-- early — and a person whose device is a day fast would be told the marathon
-- closed while it is still running. Sending the moment the row was read lets
-- the client measure its own error once and tick from there.

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
      ), '[]'::jsonb)
    ) from running r
  ) end;
$$;

revoke all on function public.marathon_active_campaign() from public;
grant execute on function public.marathon_active_campaign() to authenticated;
