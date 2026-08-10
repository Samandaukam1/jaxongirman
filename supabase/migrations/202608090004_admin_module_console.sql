-- What the admin console needs to run the data-collection module, and nothing
-- more than that.
--
-- The governing rule for every function here is that moderation works on
-- metadata. An admin can see that a survey exists, who owns it, how many people
-- answered and when it expires — and can close it. No function in this file
-- returns an answer, an uploaded file, or a respondent's identity, and the RLS
-- policies deliberately gave admins no path to those rows either.

-- ------------------------------------------------------------- overview --
/** Headline counts for the module's console page. */
create or replace function public.admin_module_overview(p_module_code text default 'data_collection')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'surveys_total', (select count(*) from public.survey_forms),
    'surveys_open', (select count(*) from public.survey_forms where status = 'open'),
    'surveys_closed', (select count(*) from public.survey_forms where status = 'closed'),
    -- Live rather than lifetime: responses past their window are gone, so a
    -- cumulative total would describe data that no longer exists.
    'responses_live', (select count(*) from public.survey_responses where expires_at > now()),
    'responses_expiring_24h', (select count(*) from public.survey_responses where expires_at between now() and now() + interval '24 hours'),
    'entitlements_active', (
      select count(*) from public.module_entitlements
      where module_code = p_module_code and status = 'active' and expires_at > now()
    ),
    'entitlements_expiring_30d', (
      select count(*) from public.module_entitlements
      where module_code = p_module_code and status = 'active'
        and expires_at between now() and now() + interval '30 days'
    ),
    'purged_last_7d', (
      select coalesce(sum(responses_purged), 0) from public.survey_purge_audit where purged_at > now() - interval '7 days'
    ),
    'templates_total', (select count(*) from public.survey_templates)
  );
end;
$$;

-- -------------------------------------------------------------- surveys --
/**
 * Survey metadata for moderation. Counts and ownership only — deliberately no
 * join reaches survey_answers, and none ever should.
 */
create or replace function public.admin_list_surveys(
  p_search text default null,
  p_status public.survey_status default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  status public.survey_status,
  owner_id uuid,
  owner_email text,
  owner_name text,
  deadline timestamptz,
  expected_participants integer,
  submitted_count integer,
  question_count bigint,
  participant_count bigint,
  live_responses bigint,
  retention_hours integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select
    f.id, f.title, f.status, f.owner_id, u.email::text, p.full_name,
    f.deadline, f.expected_participants, f.submitted_count,
    (select count(*) from public.survey_questions q where q.form_id = f.id),
    (select count(*) from public.survey_participants sp where sp.form_id = f.id),
    (select count(*) from public.survey_responses r where r.form_id = f.id and r.expires_at > now()),
    f.response_retention_hours, f.created_at
  from public.survey_forms f
  join auth.users u on u.id = f.owner_id
  join public.profiles p on p.id = f.owner_id
  where (p_status is null or f.status = p_status)
    and (
      nullif(btrim(p_search), '') is null
      or f.title ilike '%' || btrim(p_search) || '%'
      or u.email ilike '%' || btrim(p_search) || '%'
      or p.full_name ilike '%' || btrim(p_search) || '%'
    )
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

comment on function public.admin_list_surveys(text, public.survey_status, integer, integer) is
  'Survey metadata for moderation. Returns no answer content and no respondent identity, by design.';

/** Closes a survey on moderation grounds, or reopens one closed by mistake. */
create or replace function public.admin_set_survey_status(
  p_form_id uuid,
  p_status public.survey_status,
  p_reason text default ''
)
returns public.survey_forms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.survey_forms%rowtype;
  v_after public.survey_forms%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_status = 'draft'::public.survey_status then
    raise exception 'moderation may close or reopen a survey, not unpublish it' using errcode = '22023';
  end if;

  select * into v_before from public.survey_forms where id = p_form_id for update;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;

  update public.survey_forms set
    status = p_status,
    closed_at = case when p_status = 'closed'::public.survey_status then now() else null end,
    opened_at = case when p_status = 'open'::public.survey_status then coalesce(v_before.opened_at, now()) else v_before.opened_at end
    where id = p_form_id
    returning * into v_after;

  -- The owner is told, because a survey going quiet without explanation is
  -- worse than being told it was closed.
  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_before.owner_id, 'system',
    case when p_status = 'closed'::public.survey_status then 'So‘rovnoma yopildi' else 'So‘rovnoma qayta ochildi' end,
    left(btrim(coalesce(nullif(p_reason, ''), '“' || v_before.title || '” holati administrator tomonidan o‘zgartirildi.')), 500),
    jsonb_build_object('form_id', p_form_id, 'status', p_status),
    '/(app)/survey/results/' || p_form_id::text,
    p_form_id
  );

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'survey.set_status', 'survey_form', p_form_id::text,
    -- Metadata only in the audit trail too: to_jsonb(row) would be safe today
    -- but would start carrying answer counts' context the moment the table grew.
    jsonb_build_object('status', v_before.status, 'title', v_before.title),
    jsonb_build_object('status', v_after.status),
    left(btrim(coalesce(p_reason, '')), 500)
  );

  return v_after;
end;
$$;

-- --------------------------------------------------------- entitlements --
/** Who holds module access, and until when. */
create or replace function public.admin_list_module_entitlements(
  p_module_code text default 'data_collection',
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  email text,
  full_name text,
  module_code text,
  status public.entitlement_status,
  starts_at timestamptz,
  expires_at timestamptz,
  purchased_amount numeric,
  currency text,
  source text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select e.id, e.user_id, u.email::text, p.full_name, e.module_code, e.status,
    e.starts_at, e.expires_at, e.purchased_amount, e.currency, e.source, e.created_at
  from public.module_entitlements e
  join auth.users u on u.id = e.user_id
  join public.profiles p on p.id = e.user_id
  where e.module_code = p_module_code
    and (
      nullif(btrim(p_search), '') is null
      or u.email ilike '%' || btrim(p_search) || '%'
      or p.full_name ilike '%' || btrim(p_search) || '%'
    )
  order by e.expires_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

/**
 * Grants module access by email, which is the identifier a console operator
 * actually has. Wraps admin_grant_module_access so the grant, the notification
 * and the audit entry stay in one place.
 */
create or replace function public.admin_grant_module_access_by_email(
  p_email text,
  p_module_code text default 'data_collection',
  p_months integer default null,
  p_amount numeric default null,
  p_currency text default null,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no account with that email' using errcode = 'P0002';
  end if;

  return public.admin_grant_module_access(v_user_id, p_module_code, p_months, p_amount, p_currency, p_reason);
end;
$$;

-- -------------------------------------------------------- coin packages --
/** Removes a package from the catalogue. Audited like every other admin write. */
create or replace function public.admin_delete_coin_package(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.coin_packages%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_before from public.coin_packages where code = p_code;
  if not found then return false; end if;

  delete from public.coin_packages where code = p_code;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'coin_package.delete', 'coin_package', v_before.id::text, to_jsonb(v_before), '{}'::jsonb, 'Admin removed coin package');

  return true;
end;
$$;

-- ----------------------------------------------------------------- grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_module_overview(text)',
    'public.admin_list_surveys(text, public.survey_status, integer, integer)',
    'public.admin_set_survey_status(uuid, public.survey_status, text)',
    'public.admin_list_module_entitlements(text, text, integer, integer)',
    'public.admin_grant_module_access_by_email(text, text, integer, numeric, text, text)',
    'public.admin_delete_coin_package(text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
