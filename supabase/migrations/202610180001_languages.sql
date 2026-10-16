/**
 * Three languages: the app's, and each deck's own.
 *
 * `profiles.preferred_language` is the language a person uses the app in —
 * kept with the account so it follows them to another phone. `presentations
 * .language` is the language a deck is written in, chosen when it is made and
 * independent of the app's: the generator writes in it, and the server sets
 * the deck's own words (the agenda, the thanks, the labels) in it.
 *
 * An Uzbek deck is written in the Latin script. A topic typed in Cyrillic for
 * one is refused here, whatever the app checked first. A free deck (one paid
 * with welcome pages) is at most ten pages, here as well as in the app.
 */

alter table public.profiles
  add column if not exists preferred_language text not null default 'uz';
alter table public.profiles
  add constraint profiles_preferred_language check (preferred_language in ('uz', 'en', 'ru'));

alter table public.presentations
  add column if not exists language text not null default 'uz';
alter table public.presentations
  add constraint presentations_language check (language in ('uz', 'en', 'ru'));

/** Whether text holds Cyrillic letters: Russian, Uzbek Cyrillic, or the rest of the script. */
create or replace function public.has_cyrillic(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ '[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]';
$$;

drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text, integer);

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
  if coalesce(p_language, 'uz') not in ('uz', 'en', 'ru') then
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

revoke all on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text, integer, text) from public, anon;
grant execute on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text, integer, text) to authenticated;
grant execute on function public.has_cyrillic(text) to authenticated, service_role;
