-- Somewhere to keep the campaign poster.
--
-- Public, like `design-previews` and `game-assets`, because a poster is
-- marketing art shown to everybody who opens the app — signing a URL for an
-- image every user sees costs a round trip and protects nothing. Writing is
-- another matter: only an administrator puts anything here.

insert into storage.buckets (id, name, public)
values ('marathon-posters', 'marathon-posters', true)
on conflict (id) do nothing;

drop policy if exists marathon_posters_read on storage.objects;
create policy marathon_posters_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'marathon-posters');

drop policy if exists marathon_posters_write on storage.objects;
create policy marathon_posters_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marathon-posters' and (select public.is_admin()));

drop policy if exists marathon_posters_replace on storage.objects;
create policy marathon_posters_replace on storage.objects
  for update to authenticated
  using (bucket_id = 'marathon-posters' and (select public.is_admin()))
  with check (bucket_id = 'marathon-posters' and (select public.is_admin()));

drop policy if exists marathon_posters_remove on storage.objects;
create policy marathon_posters_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'marathon-posters' and (select public.is_admin()));

/**
 * The running campaign, as a person sees it.
 *
 * One call rather than three: the campaign, its reward ladder and where this
 * person stands in it. A screen that asks separately renders in three steps
 * and shows a milestone before it knows the votes behind it.
 *
 * Answers null while the marathon is off, so no screen has to check the flag
 * twice.
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

/**
 * Entering the campaign.
 *
 * Idempotent, because the button is on a screen somebody may tap twice, and
 * joining twice is not a thing that can happen.
 */
create or replace function public.marathon_join()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campaign uuid;
begin
  if v_user is null then
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

  insert into public.marathon_participants (campaign_id, user_id)
  values (v_campaign, v_user)
  on conflict (campaign_id, user_id) do nothing;

  return jsonb_build_object('campaign_id', v_campaign, 'joined', true);
end;
$$;

revoke all on function public.marathon_join() from public;
grant execute on function public.marathon_join() to authenticated;
