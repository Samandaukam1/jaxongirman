-- The member is told when their allowance runs out.
--
-- Until now the first sign of a spent plan was a refused generation. The
-- presentation that spends the last of the period now leaves a notification
-- in the inbox, linked to the tariff page where the plan can be restarted.
-- Everything else about start_generation is exactly as 202610090001 left it.

create or replace function public.start_generation(p_presentation_id uuid, p_topic text, p_title text, p_style presentation_style, p_slide_count integer, p_author_name text DEFAULT NULL::text, p_teacher_name text DEFAULT NULL::text, p_sources text[] DEFAULT '{}'::text[], p_idempotency_key text DEFAULT NULL::text, p_template_code text DEFAULT NULL::text, p_palette_code text DEFAULT NULL::text, p_design_slug text DEFAULT NULL::text)
returns table(presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entitlements jsonb;
  v_member boolean := false;
  v_plan_slides integer;
  v_quota jsonb;
  v_period text;
  v_job_id uuid;
  v_estimate integer;
  v_wallet public.credit_wallets%rowtype;
  v_idempotency text := coalesce(nullif(btrim(p_idempotency_key), ''), p_presentation_id::text);
  v_existing public.generation_jobs%rowtype;
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

  select * into v_existing
  from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_idempotency;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  -- A member's allowance, or a non-member's wallet. After the idempotency
  -- short-circuit so a retried request never spends a second presentation.
  v_entitlements := public.my_entitlements(v_user_id);
  v_member := coalesce((v_entitlements ->> 'member')::boolean, false);

  if v_member then
    v_plan_slides := coalesce(
      (v_entitlements -> 'features' -> 'presentation_max_slides' ->> 'limit')::integer, 0);
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

    -- The last presentation of the period: say so once, where the person
    -- will see it, with the way out — wait for the reset or restart the plan.
    -- Keyed on the period's reset so a refunded failure that is spent again
    -- does not say it twice.
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
        v_user_id,
        'system',
        format('%s ta taqdimotning hammasi yaratildi',
          v_quota ->> 'limit'),
        format('%s limitingiz tugadi. Tarifni qayta boshlab, yangi %s ta taqdimot yaratishingiz mumkin.',
          case v_period when 'day' then 'Kunlik' when 'month' then 'Oylik' else 'Haftalik' end,
          v_quota ->> 'limit'),
        jsonb_build_object(
          'event', 'presentation_quota_exhausted',
          'limit', v_quota -> 'limit',
          'resets_at', v_quota -> 'resets_at'),
        '/(app)/tarif'
      );
    end if;
  end if;

  v_estimate := public.estimate_presentation_credits(p_style, p_slide_count);
  if v_member then
    v_estimate := 0;
  else
    select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
    if not found then
      raise exception 'credit wallet not found' using errcode = 'P0002';
    end if;
    if v_wallet.balance < v_estimate then
      raise exception 'insufficient credits' using errcode = 'P0001', detail = format('required=%s available=%s', v_estimate, v_wallet.balance);
    end if;
  end if;

  insert into public.presentations (
    id, owner_id, title, topic, style, status, requested_slide_count,
    author_name, teacher_name, estimated_credits, reserved_credits,
    template_code, palette_code, design_id, design_version, design_engine
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_estimate, v_estimate,
    null, null, null, null, 'glass_v1'
  );

  insert into public.presentation_sources (presentation_id, owner_id, label, position)
  select p_presentation_id, v_user_id, left(btrim(source), 1000), ordinality::integer - 1
  from unnest(p_sources) with ordinality as source_rows(source, ordinality)
  where nullif(btrim(source), '') is not null;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress, reserved_credits
  ) values (
    p_presentation_id, v_user_id, v_idempotency, 'queued', 'preparing', 0, v_estimate
  ) returning id into v_job_id;

  insert into public.generation_steps (
    job_id, presentation_id, owner_id, sequence, key, label, status, progress
  ) values (
    v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda', 'queued', 0
  );

  if not v_member then
    update public.credit_wallets
      set balance = balance - v_estimate,
          reserved = reserved + v_estimate,
          version = version + 1
      where user_id = v_user_id;

    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_user_id, v_job_id, 'reservation', -v_estimate, v_estimate,
      v_wallet.balance - v_estimate, v_wallet.reserved + v_estimate,
      'reserve:' || v_idempotency, 'Presentation generation reservation',
      jsonb_build_object(
        'presentation_id', p_presentation_id, 'style', p_style, 'slide_count', p_slide_count,
        'engine', 'glass_v1'
      )
    );
  end if;

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;
