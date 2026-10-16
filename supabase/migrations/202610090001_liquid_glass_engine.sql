-- The Liquid Glass engine, and the retirement of every design made in advance.
--
-- From here on every deck's look is invented for it during generation: the
-- palette, the typefaces, the light and the glass are computed from the topic
-- by the engine in `functions/_shared/glass`. The published JSLAYD designs, the
-- PowerPoint templates and the scene engine that asked a model to place each
-- element are no longer used by any generation path, and nothing a client sends
-- can reach them.
--
-- Also here: the author's own requirements for a deck, and the premium plan
-- re-priced to what the new engine costs to run.

-- 1. What the author asked of the deck, in their own words. --------------------

alter table public.presentations
  add column if not exists requirements text;

alter table public.presentations
  drop constraint if exists presentations_requirements_length;
alter table public.presentations
  add constraint presentations_requirements_length
  check (requirements is null or char_length(requirements) <= 2000);

comment on column public.presentations.requirements is
  'Free-text requirements the author gave when creating the deck (tone, depth, what to include). Read by the generation prompts; never shown on a slide.';

-- 2. The switches, set to the only state the backend still supports. ---------
--
-- Kept rather than deleted so the admin panel and older builds that read them
-- see a consistent answer: generative on, legacy templates restricted.

insert into public.app_settings (key, value)
values
  ('design.generative_enabled', 'true'::jsonb),
  ('design.legacy_restricted', 'true'::jsonb),
  ('design.engine', '"glass_v1"'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 3. Reserving a generation no longer resolves a design. ----------------------
--
-- The JSLAYD branch is gone: no slug is read, no design is pinned, and a
-- request carrying one from an older build is treated exactly like one that
-- does not. The member's quota message now names its own period.

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

comment on function public.start_generation(uuid, text, text, presentation_style, integer, text, text, text[], text, text, text, text) is
  'Reserves a generation for the Liquid Glass engine. No design is resolved or pinned — every deck''s design is invented during generation — and the template, palette and design arguments are accepted from older builds and ignored.';

-- 4. The premium plan, priced for what the engine costs. ------------------------
--
-- 24 000 so‘m a month for twenty ten-slide presentations. Every other feature
-- of the plan is left exactly as the operator set it; only the two presentation
-- allowances and the price change, and the admin console can move them again.

update public.subscription_plans
set price_amount = 24000,
    features = jsonb_set(
      jsonb_set(
        coalesce(features, '{}'::jsonb),
        '{presentation_weekly}',
        coalesce(features -> 'presentation_weekly', '{}'::jsonb)
          || jsonb_build_object(
            'enabled', true, 'limit', 20, 'period', 'month', 'rollover', false,
            'unit', 'presentation', 'description', 'Oyiga 20 ta prezentatsiya'
          )
      ),
      '{presentation_max_slides}',
      coalesce(features -> 'presentation_max_slides', '{}'::jsonb)
        || jsonb_build_object(
          'enabled', true, 'limit', 10, 'unit', 'slide', 'description', 'Har birida 10 tagacha slayd'
        )
    )
where code = 'premium_monthly';

-- 5. A deck's typefaces, changed in one step. ---------------------------------
--
-- The editor restyles every text row of a deck when the author picks another
-- pair of faces (resized by the faces' widths on the device, so no line breaks
-- differently). One call and one transaction: a font change that saved half the
-- rows would leave a deck in two typefaces. Only text rows, only the caller's
-- own deck, and only a style object can be written.

create or replace function public.apply_deck_text_styles(p_presentation_id uuid, p_changes jsonb, p_fonts jsonb default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.presentations where id = p_presentation_id and owner_id = v_user_id) then
    raise exception 'presentation not found' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 6000 then
    raise exception 'changes must be an array of at most 6000 rows' using errcode = '22023';
  end if;

  update public.slide_elements as element
     set style = change.style
    from jsonb_to_recordset(p_changes) as change(id uuid, style jsonb)
   where element.id = change.id
     and element.presentation_id = p_presentation_id
     and element.owner_id = v_user_id
     and element.type = 'text'
     and jsonb_typeof(change.style) = 'object';
  get diagnostics v_count = row_count;

  update public.presentations
     set design_dna = case
           when p_fonts is not null and jsonb_typeof(p_fonts) = 'object'
             then coalesce(design_dna, '{}'::jsonb) || jsonb_build_object('fonts', p_fonts)
           else design_dna
         end,
         current_version = current_version + 1
   where id = p_presentation_id and owner_id = v_user_id;

  return v_count;
end;
$$;

revoke all on function public.apply_deck_text_styles(uuid, jsonb, jsonb) from public;
grant execute on function public.apply_deck_text_styles(uuid, jsonb, jsonb) to authenticated;

comment on function public.apply_deck_text_styles(uuid, jsonb, jsonb) is
  'Rewrites the style of the caller''s own text rows in one presentation, atomically. Used by the editor''s deck-wide font change.';
