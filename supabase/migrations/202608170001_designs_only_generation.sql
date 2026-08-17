-- Generation runs on published designs, and on nothing else.
--
-- Deleting a design from `presentation_designs` did not remove it from the
-- product: the built-in blueprints were compiled into the server, `start_generation`
-- fell back to `slide_templates` whenever a design did not resolve, and the user
-- panel offered that table as a second catalogue beside the first. A design
-- could therefore be withdrawn and go on being generated.
--
-- The blueprints are deleted in this change. What is left here is the rule that
-- made them reachable: no design, no generation — refused before a credit is
-- reserved rather than half way through a job the user paid for.
--
-- `slide_templates` and `palette_families` keep their rows. The migrations that
-- created them are history and stay readable, and a deck generated while they
-- were live still records what it used. Nothing reads them to make a new deck.

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
  v_job_id uuid;
  v_estimate integer;
  v_wallet public.credit_wallets%rowtype;
  v_idempotency text := coalesce(nullif(btrim(p_idempotency_key), ''), p_presentation_id::text);
  v_existing public.generation_jobs%rowtype;
  v_template text;
  v_palette text;
  v_design_id uuid;
  v_design_version integer;
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

  /**
   * A member's week, or a non-member's wallet.
   *
   * Placed after the idempotency short-circuit above on purpose: a retry of the
   * same request returns the job it already made, and must not spend a second
   * presentation out of the week.
   *
   * A subscription pays for the generation outright, so no credits are reserved
   * for it. Somebody without one keeps the credit path exactly as it was — this
   * adds a plan, it does not take away the way the product already worked.
   */
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
      raise exception 'Bu haftalik prezentatsiya limiti tugadi (% / %). Yangilanadi: %',
        v_quota ->> 'used', v_quota ->> 'limit', v_quota ->> 'resets_at'
        using errcode = 'P0001', detail = 'quota_exhausted';
    end if;
  end if;

  -- A published design of the requested tier, or nothing happens.
  --
  -- This used to fall back: an unknown slug resolved to nothing and the deck
  -- was built by a blueprint compiled into the server. That fallback is why
  -- designs withdrawn from the catalogue kept appearing in finished decks, and
  -- it is gone. A generation with no design would produce a deck nobody chose
  -- the look of, so it is refused here — before a credit is reserved — rather
  -- than half way through.
  if nullif(btrim(coalesce(p_design_slug, '')), '') is null then
    raise exception 'Dizayn tanlanmagan.' using errcode = '22023', detail = 'design_required';
  end if;

  select id, published_version into v_design_id, v_design_version
  from public.presentation_designs
  where slug = btrim(p_design_slug) and tier = p_style and status = 'published';

  if v_design_id is null then
    raise exception 'Tanlangan dizayn nashr qilinmagan yoki bu darajaga tegishli emas.'
      using errcode = '22023', detail = 'design_not_published';
  end if;

  -- The palette is a colour family inside that design, checked by the renderer
  -- against the document. `palette_families` was the catalogue of the built-in
  -- system and is no longer consulted.
  v_palette := nullif(btrim(coalesce(p_palette_code, '')), '');

  -- Still called for a member: it is also where the global slide ceiling and the
  -- style check live, and the estimate is worth recording even when the
  -- subscription is what paid.
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
    template_code, palette_code, design_id, design_version
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_estimate, v_estimate,
    null, v_palette, v_design_id, v_design_version
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

  -- Only a wallet-funded generation touches the ledger. A member's week was
  -- already spent above, and `v_wallet` was deliberately never read for them —
  -- writing this block anyway would put nulls into the balance columns.
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
        'template', v_template, 'palette', v_palette, 'design', p_design_slug
      )
    );
  end if;

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;

-- Deactivated rather than dropped: a table nothing reads but that still answers
-- `is_active = true` is a trap for whoever looks next and concludes the old
-- catalogue is still live.
update public.slide_templates set is_active = false where is_active;
update public.palette_families set is_active = false where is_active;

comment on table public.slide_templates is
  'Retired. The built-in blueprint catalogue, replaced by presentation_designs (JSLAYD). Kept for the decks that recorded a template_code.';
comment on table public.palette_families is
  'Retired. Colour families now live inside each design document.';
