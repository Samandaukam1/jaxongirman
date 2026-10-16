/**
 * Tillar va tarjimalar: what an operator writes, in every language the app speaks.
 *
 * The app's own words ship inside it, in three static tables. What an admin
 * writes — a plan's name, a coin package's label, a material type, the iOS
 * payment notice, the refund policy — lives in the database, so its other
 * languages live beside it, as `{uz, en, ru}` objects in the same shape the
 * economy console already writes for plans and packages (`*_i18n`).
 *
 * Every change is one RPC, and every change leaves an `admin_audit_logs` row
 * with the value before and after: who changed which words, when, and why.
 */

-- ------------------------------------------------------------------ columns

alter table public.subscription_plans
  add column if not exists subtitle_i18n jsonb not null default '{}'::jsonb,
  add column if not exists cta_label_i18n jsonb not null default '{}'::jsonb;

alter table public.marketplace_material_types
  add column if not exists label_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb;

/** A translation object: only uz/en/ru keys, only string values. */
create or replace function public.is_i18n_object(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(coalesce(p_value, '{}'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_each(coalesce(p_value, '{}'::jsonb)) as entry
      where entry.key not in ('uz', 'en', 'ru') or jsonb_typeof(entry.value) <> 'string'
    );
$$;

alter table public.subscription_plans
  add constraint subscription_plans_subtitle_i18n check (public.is_i18n_object(subtitle_i18n)),
  add constraint subscription_plans_cta_label_i18n check (public.is_i18n_object(cta_label_i18n));
alter table public.marketplace_material_types
  add constraint material_types_label_i18n check (public.is_i18n_object(label_i18n)),
  add constraint material_types_description_i18n check (public.is_i18n_object(description_i18n));

-- ---------------------------------------------------------------- settings

/**
 * Which languages are offered where. Uzbek is the source of every table and
 * is always on; English and Russian can be switched off for the interface or
 * for deck generation separately.
 */
insert into public.app_settings (key, value, description, public_read)
values (
  'i18n.languages',
  jsonb_build_object('ui', jsonb_build_array('uz', 'en', 'ru'), 'deck', jsonb_build_array('uz', 'en', 'ru')),
  'Languages offered in the app interface (ui) and for presentation generation (deck). Uzbek is always on.',
  true
)
on conflict (key) do nothing;

-- ------------------------------------------------------------ payment copy

/** The iOS notice now carries its translations, as `copy_i18n.{en,ru}.{key}`. */
create or replace function public.payment_policy(p_platform text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_payments jsonb;
  v_blocked boolean := public.payments_blocked_for_platform(p_platform);
begin
  select coalesce(value, '{}'::jsonb) into v_policy from public.app_settings where key = 'payments.ios_policy';
  select coalesce(value, '{}'::jsonb) into v_payments from public.app_settings where key = 'payments.config';

  return jsonb_build_object(
    'payments_enabled', not v_blocked,
    'provider_configured', coalesce((v_payments ->> 'configured')::boolean, false),
    'provider', v_payments ->> 'provider',
    'show_prices', not v_blocked,
    'copy', coalesce(v_policy -> 'copy', '{}'::jsonb),
    'copy_i18n', coalesce(v_policy -> 'copy_i18n', '{}'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------- refund policy

/**
 * The refund acknowledgement, in the words the buyer actually read.
 *
 * The app shows the policy in the buyer's language when the operator has
 * written one; what is recorded against the order must be that same sentence,
 * and which language it was in, not the Uzbek original they never saw.
 */
create or replace function public.marketplace_refund_ack(p_acknowledged boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_language text := 'uz';
  v_text text;
begin
  select value into v_policy from public.app_settings where key = 'marketplace.refund_policy';
  v_policy := coalesce(v_policy, '{}'::jsonb);

  if coalesce((v_policy ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('required', false);
  end if;

  if coalesce(p_acknowledged, false) is not true then
    raise exception 'Xaridni tasdiqlash uchun qaytarish shartlariga rozilik bering.'
      using errcode = '42501', detail = 'refund_policy_not_accepted';
  end if;

  select coalesce(preferred_language, 'uz') into v_language from public.profiles where id = auth.uid();
  v_text := nullif(v_policy -> 'i18n' -> coalesce(v_language, 'uz') ->> 'checkbox_label', '');
  if v_text is null then
    v_language := 'uz';
    v_text := v_policy ->> 'checkbox_label';
  end if;

  return jsonb_build_object(
    'required', true,
    'accepted_at', now(),
    'accepted_text', v_text,
    'language', v_language
  );
end;
$$;

revoke all on function public.marketplace_refund_ack(boolean) from public, anon;
grant execute on function public.marketplace_refund_ack(boolean) to authenticated;

-- ------------------------------------------------------------------- admin

/**
 * Every translatable piece of operator content, with its Uzbek source and the
 * other languages written so far — the list the console edits.
 */
create or replace function public.admin_translation_entries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb := '[]'::jsonb;
  v_ios jsonb;
  v_refund jsonb;
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Plans: five fields each.
  select v_entries || coalesce(jsonb_agg(entry order by sort_order, field_order), '[]'::jsonb) into v_entries
  from (
    select plan.sort_order, fields.field_order,
      jsonb_build_object(
        'entity', 'subscription_plan', 'id', plan.id::text, 'group', plan.name,
        'field', fields.field, 'source', fields.source,
        'values', coalesce(fields.translations, '{}'::jsonb), 'active', plan.is_active
      ) as entry
    from public.subscription_plans plan
    cross join lateral (values
      (1, 'name', plan.name, plan.name_i18n),
      (2, 'subtitle', plan.subtitle, plan.subtitle_i18n),
      (3, 'description', plan.description, plan.description_i18n),
      (4, 'badge', plan.badge, plan.badge_i18n),
      (5, 'cta_label', plan.cta_label, plan.cta_label_i18n)
    ) as fields(field_order, field, source, translations)
    where coalesce(fields.source, '') <> ''
  ) plans;

  -- Coin packages.
  select v_entries || coalesce(jsonb_agg(entry order by sort_order, field_order), '[]'::jsonb) into v_entries
  from (
    select package.sort_order, fields.field_order,
      jsonb_build_object(
        'entity', 'coin_package', 'id', package.id::text, 'group', package.label,
        'field', fields.field, 'source', fields.source,
        'values', coalesce(fields.translations, '{}'::jsonb), 'active', package.is_active
      ) as entry
    from public.coin_packages package
    cross join lateral (values
      (1, 'label', package.label, package.label_i18n),
      (2, 'description', package.description, package.description_i18n)
    ) as fields(field_order, field, source, translations)
    where coalesce(fields.source, '') <> ''
  ) packages;

  -- Marketplace material types.
  select v_entries || coalesce(jsonb_agg(entry order by sort_order, field_order), '[]'::jsonb) into v_entries
  from (
    select kind.sort_order, fields.field_order,
      jsonb_build_object(
        'entity', 'material_type', 'id', kind.code, 'group', kind.label,
        'field', fields.field, 'source', fields.source,
        'values', coalesce(fields.translations, '{}'::jsonb), 'active', kind.is_active
      ) as entry
    from public.marketplace_material_types kind
    cross join lateral (values
      (1, 'label', kind.label, kind.label_i18n),
      (2, 'description', kind.description, kind.description_i18n)
    ) as fields(field_order, field, source, translations)
    where coalesce(fields.source, '') <> ''
  ) kinds;

  -- The iOS payment notice, one entry per sentence.
  select coalesce(value, '{}'::jsonb) into v_ios from public.app_settings where key = 'payments.ios_policy';
  foreach v_key in array array['subscription', 'jcoin', 'marketplace', 'module'] loop
    if coalesce(v_ios -> 'copy' ->> v_key, '') <> '' then
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'entity', 'setting', 'id', 'payments.ios_policy', 'group', 'iOS to‘lov xabari',
        'field', 'copy.' || v_key, 'source', v_ios -> 'copy' ->> v_key,
        'values', jsonb_strip_nulls(jsonb_build_object(
          'en', v_ios -> 'copy_i18n' -> 'en' ->> v_key,
          'ru', v_ios -> 'copy_i18n' -> 'ru' ->> v_key)),
        'active', true));
    end if;
  end loop;

  -- The refund policy.
  select coalesce(value, '{}'::jsonb) into v_refund from public.app_settings where key = 'marketplace.refund_policy';
  foreach v_key in array array['title', 'body', 'checkbox_label'] loop
    if coalesce(v_refund ->> v_key, '') <> '' then
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'entity', 'setting', 'id', 'marketplace.refund_policy', 'group', 'Qaytarish siyosati',
        'field', v_key, 'source', v_refund ->> v_key,
        'values', jsonb_strip_nulls(jsonb_build_object(
          'en', v_refund -> 'i18n' -> 'en' ->> v_key,
          'ru', v_refund -> 'i18n' -> 'ru' ->> v_key)),
        'active', coalesce((v_refund ->> 'enabled')::boolean, false)));
    end if;
  end loop;

  return v_entries;
end;
$$;

/**
 * One field's English and Russian, written and audited.
 *
 * `p_values` holds `en` and/or `ru`; an empty string removes that language,
 * so the app falls back to Uzbek. Uzbek itself is the source text and is
 * edited where the content is edited, not here.
 */
create or replace function public.admin_set_translation(
  p_entity text,
  p_id text,
  p_field text,
  p_values jsonb,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_column text;
  v_before jsonb;
  v_after jsonb;
  v_language text;
  v_setting jsonb;
  v_path text[];
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(v_values) <> 'object' or exists (
    select 1 from jsonb_each(v_values) entry
    where entry.key not in ('en', 'ru') or jsonb_typeof(entry.value) <> 'string'
  ) then
    raise exception 'translations must be an object of en/ru strings' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each_text(v_values) entry where length(entry.value) > 4000) then
    raise exception 'translation is too long' using errcode = '22023';
  end if;

  if p_entity in ('subscription_plan', 'coin_package', 'material_type') then
    v_column := case
      when p_entity = 'subscription_plan' and p_field in ('name', 'subtitle', 'description', 'badge', 'cta_label') then p_field || '_i18n'
      when p_entity = 'coin_package' and p_field in ('label', 'description') then p_field || '_i18n'
      when p_entity = 'material_type' and p_field in ('label', 'description') then p_field || '_i18n'
    end;
    if v_column is null then
      raise exception 'unknown translatable field %.%', p_entity, p_field using errcode = '22023';
    end if;

    if p_entity = 'subscription_plan' then
      execute format('select %I from public.subscription_plans where id = $1::uuid', v_column) into v_before using p_id;
    elsif p_entity = 'coin_package' then
      execute format('select %I from public.coin_packages where id = $1::uuid', v_column) into v_before using p_id;
    else
      execute format('select %I from public.marketplace_material_types where code = $1', v_column) into v_before using p_id;
    end if;
    if v_before is null then
      raise exception 'translatable row not found' using errcode = '02000';
    end if;

    v_after := v_before;
    for v_language in select jsonb_object_keys(v_values) loop
      if btrim(v_values ->> v_language) = '' then
        v_after := v_after - v_language;
      else
        v_after := jsonb_set(v_after, array[v_language], to_jsonb(btrim(v_values ->> v_language)));
      end if;
    end loop;

    if p_entity = 'subscription_plan' then
      execute format('update public.subscription_plans set %I = $1, updated_at = now() where id = $2::uuid', v_column) using v_after, p_id;
    elsif p_entity = 'coin_package' then
      execute format('update public.coin_packages set %I = $1 where id = $2::uuid', v_column) using v_after, p_id;
    else
      execute format('update public.marketplace_material_types set %I = $1, updated_at = now() where code = $2', v_column) using v_after, p_id;
    end if;

  elsif p_entity = 'setting' and p_id in ('payments.ios_policy', 'marketplace.refund_policy') then
    if p_id = 'payments.ios_policy' and p_field not in ('copy.subscription', 'copy.jcoin', 'copy.marketplace', 'copy.module') then
      raise exception 'unknown translatable field %.%', p_id, p_field using errcode = '22023';
    end if;
    if p_id = 'marketplace.refund_policy' and p_field not in ('title', 'body', 'checkbox_label') then
      raise exception 'unknown translatable field %.%', p_id, p_field using errcode = '22023';
    end if;

    select coalesce(value, '{}'::jsonb) into v_setting from public.app_settings where key = p_id for update;
    if v_setting is null then
      raise exception 'setting not found' using errcode = '02000';
    end if;

    v_before := jsonb_strip_nulls(jsonb_build_object(
      'en', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'en' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'en' -> p_field end,
      'ru', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'ru' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'ru' -> p_field end));

    for v_language in select jsonb_object_keys(v_values) loop
      v_path := case when p_id = 'payments.ios_policy'
        then array['copy_i18n', v_language, split_part(p_field, '.', 2)]
        else array['i18n', v_language, p_field] end;
      -- Make sure the containers exist before setting inside them.
      if v_setting #> v_path[1:1] is null then v_setting := jsonb_set(v_setting, v_path[1:1], '{}'::jsonb); end if;
      if v_setting #> v_path[1:2] is null then v_setting := jsonb_set(v_setting, v_path[1:2], '{}'::jsonb); end if;
      if btrim(v_values ->> v_language) = '' then
        v_setting := v_setting #- v_path;
      else
        v_setting := jsonb_set(v_setting, v_path, to_jsonb(btrim(v_values ->> v_language)));
      end if;
    end loop;

    update public.app_settings set value = v_setting, updated_by = v_admin where key = p_id;

    v_after := jsonb_strip_nulls(jsonb_build_object(
      'en', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'en' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'en' -> p_field end,
      'ru', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'ru' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'ru' -> p_field end));
  else
    raise exception 'unknown translatable entity %', p_entity using errcode = '22023';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'translation.updated', p_entity, p_id || ':' || p_field,
    jsonb_build_object('field', p_field, 'values', v_before),
    jsonb_build_object('field', p_field, 'values', v_after),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  return jsonb_build_object('entity', p_entity, 'id', p_id, 'field', p_field, 'values', v_after);
end;
$$;

/**
 * Switching a language on or off, for the interface or for decks. Uzbek
 * cannot be switched off anywhere; it is the source of every table.
 */
create or replace function public.admin_set_language_settings(p_value jsonb, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_kind text;
begin
  if not public.is_super_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  foreach v_kind in array array['ui', 'deck'] loop
    if jsonb_typeof(p_value -> v_kind) <> 'array' then
      raise exception '% must be a list of languages', v_kind using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_value -> v_kind) language
      where language not in ('uz', 'en', 'ru')
    ) then
      raise exception 'unknown language in %', v_kind using errcode = '22023';
    end if;
    if not (p_value -> v_kind) ? 'uz' then
      raise exception 'Uzbek cannot be switched off' using errcode = '22023';
    end if;
  end loop;

  select value into v_before from public.app_settings where key = 'i18n.languages' for update;
  v_after := jsonb_build_object(
    'ui', (select jsonb_agg(distinct language order by language) from jsonb_array_elements_text(p_value -> 'ui') language),
    'deck', (select jsonb_agg(distinct language order by language) from jsonb_array_elements_text(p_value -> 'deck') language)
  );

  insert into public.app_settings (key, value, description, public_read, updated_by)
  values ('i18n.languages', v_after, 'Languages offered in the app interface (ui) and for presentation generation (deck). Uzbek is always on.', true, v_admin)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'languages.updated', 'app_setting', 'i18n.languages', v_before, v_after, nullif(btrim(coalesce(p_reason, '')), ''));

  return v_after;
end;
$$;

/**
 * The console's picture of the three languages: which are on, who uses which,
 * which decks were made in which, what the writing cost per language, how much
 * operator content is translated, and the last changes.
 */
create or replace function public.admin_language_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_entries := public.admin_translation_entries();

  return jsonb_build_object(
    'settings', coalesce(
      (select value from public.app_settings where key = 'i18n.languages'),
      jsonb_build_object('ui', jsonb_build_array('uz', 'en', 'ru'), 'deck', jsonb_build_array('uz', 'en', 'ru'))),
    'users', coalesce((
      select jsonb_object_agg(language, total) from (
        select preferred_language as language, count(*) as total from public.profiles group by preferred_language
      ) counts), '{}'::jsonb),
    'decks', coalesce((
      select jsonb_object_agg(language, jsonb_build_object('total', total, 'last_30_days', recent)) from (
        select language, count(*) as total, count(*) filter (where created_at > now() - interval '30 days') as recent
        from public.presentations group by language
      ) counts), '{}'::jsonb),
    'usage', coalesce((
      select jsonb_object_agg(language, jsonb_build_object(
        'input_tokens', input_tokens, 'output_tokens', output_tokens, 'cost_usd', cost, 'decks', decks)) from (
        select coalesce(usage.metadata ->> 'language', deck.language, 'uz') as language,
          sum(usage.input_tokens) as input_tokens, sum(usage.output_tokens) as output_tokens,
          round(sum(usage.provider_cost_usd)::numeric, 4) as cost,
          count(distinct usage.presentation_id) as decks
        from public.ai_usage usage
        left join public.presentations deck on deck.id = usage.presentation_id
        where usage.created_at > now() - interval '30 days' and usage.presentation_id is not null
        group by 1
      ) totals), '{}'::jsonb),
    'coverage', jsonb_build_object(
      'total', jsonb_array_length(v_entries),
      'en', (select count(*) from jsonb_array_elements(v_entries) entry where coalesce(entry -> 'values' ->> 'en', '') <> ''),
      'ru', (select count(*) from jsonb_array_elements(v_entries) entry where coalesce(entry -> 'values' ->> 'ru', '') <> '')
    ),
    'history', coalesce((
      select jsonb_agg(row order by created_at desc) from (
        select log.id, log.action, log.target_type, log.target_id, log.before_data, log.after_data, log.reason, log.created_at,
          coalesce(profile.full_name, profile.username, '') as admin_name
        from public.admin_audit_logs log
        left join public.profiles profile on profile.id = log.admin_id
        where log.action in ('translation.updated', 'languages.updated')
        order by log.created_at desc
        limit 50
      ) row), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.is_i18n_object(jsonb) from public;
grant execute on function public.is_i18n_object(jsonb) to anon, authenticated, service_role;
revoke all on function public.admin_translation_entries() from public, anon;
revoke all on function public.admin_set_translation(text, text, text, jsonb, text) from public, anon;
revoke all on function public.admin_set_language_settings(jsonb, text) from public, anon;
revoke all on function public.admin_language_overview() from public, anon;
grant execute on function public.admin_translation_entries() to authenticated;
grant execute on function public.admin_set_translation(text, text, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_language_settings(jsonb, text) to authenticated;
grant execute on function public.admin_language_overview() to authenticated;
