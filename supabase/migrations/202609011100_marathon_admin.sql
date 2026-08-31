-- The console's half: building a campaign months before anybody sees it.
--
-- §30 is the point of this file. An administrator must be able to write the
-- whole thing — poster, rules, dates, reward ladder, prices — while every
-- switch is off and no user can tell the feature exists. So nothing here reads
-- the visibility flag: it edits, and a separate, audited, deliberate action
-- turns the campaign on.

-- The market switch has to be readable by the app that obeys it. Without this
-- the setting is invisible to `authenticated` and the market stays shut no
-- matter what the console says.
update public.app_settings
   set public_read = true
 where key = 'marathon.vote_marketplace_enabled';

/**
 * The vote market's own switch, audited like the marathon's.
 *
 * Separate on purpose: a campaign can run for a week before anybody is allowed
 * to trade votes, and closing the market must not close the marathon.
 */
create or replace function public.admin_set_vote_marketplace(
  p_enabled boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.app_settings
     set value = to_jsonb(p_enabled), updated_at = now(), updated_by = v_actor
   where key = 'marathon.vote_marketplace_enabled';

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (v_actor, 'marathon.market_changed', 'app_settings',
          'marathon.vote_marketplace_enabled', p_reason,
          jsonb_build_object('enabled', p_enabled));

  return jsonb_build_object('marathon_vote_marketplace_enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_vote_marketplace(boolean, text) from public;
grant execute on function public.admin_set_vote_marketplace(boolean, text) to authenticated;

/**
 * Everything the console needs to draw the campaign editor, in one answer.
 *
 * Campaigns with their ladders, both switches, and how many people have
 * entered — the last of which is the only honest way to answer "can I still
 * change the dates".
 */
create or replace function public.admin_marathon_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'marathon_enabled', coalesce((select value = 'true'::jsonb from public.app_settings
                                   where key = 'student_marathon_enabled'), false),
    'market_enabled', coalesce((select value = 'true'::jsonb from public.app_settings
                                 where key = 'marathon.vote_marketplace_enabled'), false),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'description', c.description,
        'rules', c.rules,
        'poster_path', c.poster_path,
        'status', c.status,
        'starts_at', c.starts_at,
        'ends_at', c.ends_at,
        'contract_cap', c.contract_cap,
        'min_free_price', c.min_free_price,
        'min_premium_price', c.min_premium_price,
        'participants', (select count(*) from public.marathon_participants p where p.campaign_id = c.id),
        'votes', (select count(*) from public.marathon_vote_ledger v where v.campaign_id = c.id),
        'tiers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', t.position,
            'votes_required', t.votes_required,
            'premium_required', t.premium_required,
            'reward_percent', t.reward_percent
          ) order by t.position)
          from public.marathon_reward_tiers t where t.campaign_id = c.id), '[]'::jsonb)
      ) order by c.created_at desc)
      from public.marathon_campaigns c), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.admin_marathon_overview() from public;
grant execute on function public.admin_marathon_overview() to authenticated;

/**
 * Writing a campaign.
 *
 * A draft is entirely editable. A running one is not: the dates, the cap and
 * the floors are what people entered on, and changing them mid-campaign would
 * move the finish line under somebody who is running for it. The poster, the
 * description and the rules stay editable, because fixing a typo in the rules
 * is not moving the finish line.
 */
create or replace function public.admin_save_marathon_campaign(
  p_id uuid,
  p_title text,
  p_description text default '',
  p_rules text default '',
  p_poster_path text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_contract_cap bigint default null,
  p_min_free_price integer default null,
  p_min_premium_price integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.marathon_campaigns%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'Kampaniya nomi bo''sh bo''lmasin.' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_row from public.marathon_campaigns where id = p_id for update;
    if not found then
      raise exception 'Kampaniya topilmadi.' using errcode = 'P0002';
    end if;
  end if;

  if v_row.id is null then
    insert into public.marathon_campaigns (
      title, description, rules, poster_path, status,
      starts_at, ends_at, contract_cap, min_free_price, min_premium_price
    ) values (
      btrim(p_title), coalesce(p_description, ''), coalesce(p_rules, ''), p_poster_path, 'draft',
      coalesce(p_starts_at, now()), coalesce(p_ends_at, now() + interval '30 days'),
      coalesce(p_contract_cap, 10000000),
      coalesce(p_min_free_price, 5000), coalesce(p_min_premium_price, 15000)
    )
    returning * into v_row;
  elsif v_row.status = 'draft' then
    update public.marathon_campaigns set
      title = btrim(p_title),
      description = coalesce(p_description, description),
      rules = coalesce(p_rules, rules),
      poster_path = coalesce(p_poster_path, poster_path),
      starts_at = coalesce(p_starts_at, starts_at),
      ends_at = coalesce(p_ends_at, ends_at),
      contract_cap = coalesce(p_contract_cap, contract_cap),
      min_free_price = coalesce(p_min_free_price, min_free_price),
      min_premium_price = coalesce(p_min_premium_price, min_premium_price)
      where id = v_row.id
    returning * into v_row;
  else
    -- Running or finished: only the words and the picture.
    update public.marathon_campaigns set
      title = btrim(p_title),
      description = coalesce(p_description, description),
      rules = coalesce(p_rules, rules),
      poster_path = coalesce(p_poster_path, poster_path)
      where id = v_row.id
    returning * into v_row;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_actor, 'marathon.campaign_saved', 'marathon_campaigns', v_row.id::text,
          jsonb_build_object('title', v_row.title, 'status', v_row.status));

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_save_marathon_campaign(uuid, text, text, text, text, timestamptz, timestamptz, bigint, integer, integer) from public;
grant execute on function public.admin_save_marathon_campaign(uuid, text, text, text, text, timestamptz, timestamptz, bigint, integer, integer) to authenticated;

/**
 * The reward ladder, written whole.
 *
 * Replaced rather than patched, because a ladder is only meaningful as a
 * sequence — and only while the campaign is a draft: a rung moved under a
 * candidate who has already climbed most of it is the one change nobody could
 * be asked to accept.
 */
create or replace function public.admin_set_marathon_tiers(p_campaign_id uuid, p_tiers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_status public.marathon_status;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select status into v_status from public.marathon_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'Kampaniya topilmadi.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'Boshlangan marafonning marralarini o''zgartirib bo''lmaydi.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'Kamida bitta marra kerak.' using errcode = '22023';
  end if;

  delete from public.marathon_reward_tiers where campaign_id = p_campaign_id;

  insert into public.marathon_reward_tiers (campaign_id, position, votes_required, premium_required, reward_percent)
  select
    p_campaign_id,
    (row_number() over (order by (tier ->> 'votes_required')::integer))::smallint,
    (tier ->> 'votes_required')::integer,
    (tier ->> 'premium_required')::integer,
    (tier ->> 'reward_percent')::smallint
  from jsonb_array_elements(p_tiers) as tier;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_actor, 'marathon.tiers_saved', 'marathon_campaigns', p_campaign_id::text, p_tiers);

  return jsonb_build_object('campaign_id', p_campaign_id, 'tiers', jsonb_array_length(p_tiers));
end;
$$;

revoke all on function public.admin_set_marathon_tiers(uuid, jsonb) from public;
grant execute on function public.admin_set_marathon_tiers(uuid, jsonb) to authenticated;

/**
 * Launching, which is the one action that makes all of this visible.
 *
 * Deliberately not a side effect of anything: the flag is turned on here, by an
 * administrator, on a named campaign, after the checks below — a poster, a
 * ladder, dates that make sense, and no other campaign already running. §34 is
 * explicit that nothing else may ever turn it on.
 */
create or replace function public.admin_launch_marathon(p_campaign_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.marathon_campaigns%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.marathon_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'Kampaniya topilmadi.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Bu kampaniya allaqachon ishga tushirilgan.' using errcode = 'P0001';
  end if;
  if v_row.poster_path is null then
    raise exception 'Afisha yuklanmagan.' using errcode = 'P0001', detail = 'poster_required';
  end if;
  if not exists (select 1 from public.marathon_reward_tiers where campaign_id = p_campaign_id) then
    raise exception 'Sovrinlar zinapoyasi bo''sh.' using errcode = 'P0001', detail = 'tiers_required';
  end if;
  if v_row.ends_at <= now() then
    raise exception 'Tugash sanasi o''tib ketgan.' using errcode = 'P0001', detail = 'dates_invalid';
  end if;
  if exists (select 1 from public.marathon_campaigns where status = 'active' and id <> p_campaign_id) then
    raise exception 'Boshqa marafon allaqachon davom etmoqda.' using errcode = 'P0001';
  end if;

  update public.marathon_campaigns set status = 'active' where id = p_campaign_id;

  update public.app_settings
     set value = to_jsonb(true), updated_at = now(), updated_by = v_actor
   where key = 'student_marathon_enabled';

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (v_actor, 'marathon.launched', 'marathon_campaigns', p_campaign_id::text, p_reason,
          jsonb_build_object('title', v_row.title, 'ends_at', v_row.ends_at));

  return jsonb_build_object('campaign_id', p_campaign_id, 'status', 'active', 'visible', true);
end;
$$;

revoke all on function public.admin_launch_marathon(uuid, text) from public;
grant execute on function public.admin_launch_marathon(uuid, text) to authenticated;

/**
 * Ending a campaign, and taking the marathon off the app with it.
 *
 * The reverse of a launch, and just as explicit. The ledger stays: it is the
 * record of what happened, and the reward decisions made against it have to
 * remain checkable long after the campaign is over.
 */
create or replace function public.admin_end_marathon(p_campaign_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.marathon_campaigns set status = 'ended'
   where id = p_campaign_id and status = 'active';
  if not found then
    raise exception 'Bu kampaniya faol emas.' using errcode = 'P0001';
  end if;

  update public.app_settings
     set value = to_jsonb(false), updated_at = now(), updated_by = v_actor
   where key = 'student_marathon_enabled';

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (v_actor, 'marathon.ended', 'marathon_campaigns', p_campaign_id::text, p_reason,
          jsonb_build_object('ended_at', now()));

  return jsonb_build_object('campaign_id', p_campaign_id, 'status', 'ended', 'visible', false);
end;
$$;

revoke all on function public.admin_end_marathon(uuid, text) from public;
grant execute on function public.admin_end_marathon(uuid, text) to authenticated;
