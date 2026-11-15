-- Turkish: the fourth language.
--
-- The app's interface, its decks, its games and the defence scripts can now be
-- Turkish ('tr'), next to Uzbek, English and Russian. This widens every place
-- that lists the languages — the three columns that store one, deck generation,
-- the operator's language switch and the shape of translated operator texts —
-- and offers Turkish in the interface and for decks. Nothing else about these
-- functions changes: each is its previous definition with 'tr' added to the
-- list. An operator can still switch Turkish off ("Tillar va tarjimalar").

alter table public.profiles drop constraint if exists profiles_preferred_language;
alter table public.profiles
  add constraint profiles_preferred_language check (preferred_language in ('uz', 'en', 'ru', 'tr'));

alter table public.presentations drop constraint if exists presentations_language;
alter table public.presentations
  add constraint presentations_language check (language in ('uz', 'en', 'ru', 'tr'));

alter table public.games drop constraint if exists games_language_check;
alter table public.games
  add constraint games_language_check check (language in ('uz', 'en', 'ru', 'tr'));

comment on column public.games.language is 'Language the questions are written in: uz (Latin), en, ru or tr.';

-- Offered from the start, in the interface and for decks.
update public.app_settings
set value = jsonb_build_object(
  'ui', case when coalesce(value -> 'ui', '[]'::jsonb) ? 'tr' then value -> 'ui' else coalesce(value -> 'ui', '[]'::jsonb) || '["tr"]'::jsonb end,
  'deck', case when coalesce(value -> 'deck', '[]'::jsonb) ? 'tr' then value -> 'deck' else coalesce(value -> 'deck', '[]'::jsonb) || '["tr"]'::jsonb end
)
where key = 'i18n.languages';

/** Operator texts may carry a Turkish translation beside the others. */
create or replace function public.is_i18n_object(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(coalesce(p_value, '{}'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_each(coalesce(p_value, '{}'::jsonb)) as entry
      where entry.key not in ('uz', 'en', 'ru', 'tr') or jsonb_typeof(entry.value) <> 'string'
    );
$$;

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
      where language not in ('uz', 'en', 'ru', 'tr')
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

create or replace function public.start_generation(
  p_presentation_id uuid, p_topic text, p_title text, p_style public.presentation_style, p_slide_count integer,
  p_author_name text default null, p_teacher_name text default null, p_sources text[] default '{}'::text[],
  p_idempotency_key text default null, p_template_code text default null, p_palette_code text default null,
  p_design_slug text default null, p_confirmed_coins integer default null,
  p_language text default 'uz'
)
returns table(presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entitlements jsonb;
  v_quota_member boolean := false;
  v_plan_slides integer;
  v_quota jsonb;
  v_quote jsonb;
  v_period text;
  v_job_id uuid;
  v_coins integer := 0;
  v_wallet public.credit_wallets%rowtype;
  v_idempotency text := coalesce(nullif(btrim(p_idempotency_key), ''), p_presentation_id::text);
  v_existing public.generation_jobs%rowtype;
  v_pages jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_presentation_id is null or char_length(btrim(p_topic)) < 3 then
    raise exception 'valid presentation id and topic are required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_user_id and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
  if coalesce(p_language, 'uz') not in ('uz', 'en', 'ru', 'tr') then
    raise exception 'unsupported presentation language' using errcode = '22023';
  end if;
  -- An operator can switch a language off for decks (Tillar va tarjimalar).
  -- Uzbek is the source language and is never switched off.
  if coalesce(p_language, 'uz') <> 'uz' and not coalesce((
    select (value -> 'deck') ? p_language from public.app_settings where key = 'i18n.languages'
  ), true) then
    raise exception 'Bu tilda taqdimot yaratish hozircha o‘chirilgan.'
      using errcode = '22023', detail = 'language_disabled';
  end if;
  -- An Uzbek deck is written in the Latin script, and so is its topic.
  if coalesce(p_language, 'uz') = 'uz' and (public.has_cyrillic(p_topic) or public.has_cyrillic(coalesce(p_title, ''))) then
    raise exception 'Mavzuni lotin yozuvida kiriting.' using errcode = '22023', detail = 'cyrillic_topic';
  end if;

  select * into v_existing
  from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_idempotency;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  perform public.expire_coin_lots(v_user_id);
  v_entitlements := public.my_entitlements(v_user_id);
  v_quota_member := coalesce((v_entitlements ->> 'member')::boolean, false)
    and coalesce(v_entitlements -> 'plan' ->> 'billing', 'quota') = 'quota';

  if v_quota_member then
    v_plan_slides := coalesce((v_entitlements -> 'features' -> 'presentation_max_slides' ->> 'limit')::integer, 0);
    if v_plan_slides > 0 and p_slide_count > v_plan_slides then
      raise exception 'Tarifingizda bitta prezentatsiya uchun eng ko''pi % ta slayd.', v_plan_slides
        using errcode = '22023';
    end if;

    v_quota := public.quota_consume('presentation_weekly', 1, v_user_id);
    if coalesce((v_quota ->> 'ok')::boolean, false) is not true then
      v_period := coalesce(v_entitlements -> 'features' -> 'presentation_weekly' ->> 'period', 'week');
      raise exception '% prezentatsiya limiti tugadi (% / %). Yangilanadi: %',
        case v_period when 'day' then 'Kunlik' when 'month' then 'Oylik' else 'Haftalik' end,
        v_quota ->> 'used', v_quota ->> 'limit', v_quota ->> 'resets_at'
        using errcode = 'P0001', detail = 'quota_exhausted';
    end if;

    if (v_quota ->> 'remaining')::integer = 0
      and not exists (
        select 1 from public.notifications
        where user_id = v_user_id
          and payload ->> 'event' = 'presentation_quota_exhausted'
          and payload ->> 'resets_at' is not distinct from v_quota ->> 'resets_at'
      )
    then
      v_period := coalesce(v_entitlements -> 'features' -> 'presentation_weekly' ->> 'period', 'week');
      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (
        v_user_id, 'system',
        format('%s ta taqdimotning hammasi yaratildi', v_quota ->> 'limit'),
        format('%s limitingiz tugadi. Tarifni qayta boshlab, yangi %s ta taqdimot yaratishingiz mumkin.',
          case v_period when 'day' then 'Kunlik' when 'month' then 'Oylik' else 'Haftalik' end,
          v_quota ->> 'limit'),
        jsonb_build_object('event', 'presentation_quota_exhausted', 'limit', v_quota -> 'limit', 'resets_at', v_quota -> 'resets_at'),
        '/(app)/tarif'
      );
    end if;
    v_quote := jsonb_build_object('mode', 'quota', 'pages', p_slide_count, 'coins', 0);
  else
    v_quote := public.presentation_quote_for(v_user_id, p_slide_count);
    v_coins := (v_quote ->> 'coins')::integer;

    -- A free deck — one that takes welcome pages — is at most ten pages: the
    -- welcome promises three ten-page decks, not one deck of thirty.
    if coalesce((v_quote ->> 'welcome_pages')::integer, 0) > 0 and p_slide_count > 10 then
      raise exception 'Bepul taqdimot maksimum 10 sahifali bo‘lishi mumkin.'
        using errcode = '22023', detail = 'free_deck_max_pages';
    end if;
    if v_coins > 0 then
      if p_confirmed_coins is not null and p_confirmed_coins < v_coins then
        raise exception 'Narx yangilandi: bu taqdimot % J Tanga turadi. Iltimos, qayta tasdiqlang.', v_coins
          using errcode = 'P0001', detail = 'confirmation_required';
      end if;
      select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
      if not found then
        raise exception 'credit wallet not found' using errcode = 'P0002';
      end if;
      if v_wallet.balance < v_coins then
        raise exception 'insufficient credits' using errcode = 'P0001',
          detail = format('required=%s available=%s', v_coins, v_wallet.balance);
      end if;
    end if;
  end if;

  insert into public.presentations (
    id, owner_id, title, topic, style, status, requested_slide_count,
    author_name, teacher_name, estimated_credits, reserved_credits,
    template_code, palette_code, design_id, design_version, design_engine, language
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_coins, v_coins,
    null, null, null, null, 'glass_v1', coalesce(p_language, 'uz')
  );

  insert into public.presentation_sources (presentation_id, owner_id, label, position)
  select p_presentation_id, v_user_id, left(btrim(source), 1000), ordinality::integer - 1
  from unnest(p_sources) with ordinality as source_rows(source, ordinality)
  where nullif(btrim(source), '') is not null;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress, reserved_credits, pricing
  ) values (
    p_presentation_id, v_user_id, v_idempotency, 'queued', 'preparing', 0, v_coins, v_quote
  ) returning id into v_job_id;

  insert into public.generation_steps (
    job_id, presentation_id, owner_id, sequence, key, label, status, progress
  ) values (
    v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda', 'queued', 0
  );

  if not v_quota_member then
    if coalesce((v_quote ->> 'welcome_pages')::integer, 0) + coalesce((v_quote ->> 'purchased_pages')::integer, 0) > 0 then
      v_pages := public.presentation_pages_reserve(v_user_id, v_job_id,
        (v_quote ->> 'welcome_pages')::integer + (v_quote ->> 'purchased_pages')::integer);
    end if;

    if v_coins > 0 then
      insert into public.credit_transactions (
        user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
        idempotency_key, description, metadata
      ) values (
        v_user_id, v_job_id, 'reservation', -v_coins, v_coins,
        v_wallet.balance - v_coins, v_wallet.reserved + v_coins,
        'reserve:' || v_idempotency, 'Taqdimot uchun J Tanga band qilindi',
        jsonb_build_object(
          'presentation_id', p_presentation_id, 'slide_count', p_slide_count, 'engine', 'glass_v1',
          'pages', v_quote -> 'paid_pages', 'per_page', v_quote -> 'per_page', 'version', v_quote -> 'version')
      );
      update public.credit_wallets
        set balance = balance - v_coins, reserved = reserved + v_coins, version = version + 1
        where user_id = v_user_id;
    end if;
  end if;

  return query select p_presentation_id, v_job_id, v_coins;
end;
$$;

/** The console lists and writes Turkish translations of operator texts too. */
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
          'ru', v_ios -> 'copy_i18n' -> 'ru' ->> v_key,
          'tr', v_ios -> 'copy_i18n' -> 'tr' ->> v_key)),
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
          'ru', v_refund -> 'i18n' -> 'ru' ->> v_key,
          'tr', v_refund -> 'i18n' -> 'tr' ->> v_key)),
        'active', coalesce((v_refund ->> 'enabled')::boolean, false)));
    end if;
  end loop;

  return v_entries;
end;
$$;

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
    where entry.key not in ('en', 'ru', 'tr') or jsonb_typeof(entry.value) <> 'string'
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
        else v_setting -> 'i18n' -> 'ru' -> p_field end,
      'tr', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'tr' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'tr' -> p_field end));

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
        else v_setting -> 'i18n' -> 'ru' -> p_field end,
      'tr', case when p_id = 'payments.ios_policy'
        then v_setting -> 'copy_i18n' -> 'tr' -> split_part(p_field, '.', 2)
        else v_setting -> 'i18n' -> 'tr' -> p_field end));
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
