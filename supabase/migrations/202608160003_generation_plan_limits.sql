-- The plan meets the work: generation.
--
-- A subscription pays for a generation outright — four a week, sixteen slides
-- each — and reserves no credits for it. Somebody without a subscription keeps
-- the credit path exactly as it was: this adds a plan, it does not take away
-- the way the product already worked.
--
-- The allowance is spent after the idempotency short-circuit, so a retry of the
-- same request returns the job it already made rather than costing a second
-- presentation, and it is given back when a generation fails for a reason that
-- was ours.

CREATE OR REPLACE FUNCTION public.start_generation(p_presentation_id uuid, p_topic text, p_title text, p_style presentation_style, p_slide_count integer, p_author_name text DEFAULT NULL::text, p_teacher_name text DEFAULT NULL::text, p_sources text[] DEFAULT '{}'::text[], p_idempotency_key text DEFAULT NULL::text, p_template_code text DEFAULT NULL::text, p_palette_code text DEFAULT NULL::text, p_design_slug text DEFAULT NULL::text)
 RETURNS TABLE(presentation_id uuid, job_id uuid, estimated_credits integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select code into v_template from public.slide_templates
  where code = p_template_code and style = p_style and is_active;
  if v_template is null then
    select code into v_template from public.slide_templates
    where style = p_style and is_active order by sort_order limit 1;
  end if;
  if v_template is null then
    raise exception 'no active template for style %', p_style using errcode = '22023';
  end if;

  select code into v_palette from public.palette_families where code = p_palette_code and is_active;
  if v_palette is null then
    select code into v_palette from public.palette_families where is_active order by sort_order limit 1;
  end if;

  -- Only a published design of the requested tier is accepted. A draft slug or
  -- a slug from another tier resolves to nothing and the deck quietly takes the
  -- built-in path, which is the same thing that happens to an unknown template
  -- code — an unrecognised choice must never fail a generation the user paid
  -- for.
  if nullif(btrim(coalesce(p_design_slug, '')), '') is not null then
    select id, published_version into v_design_id, v_design_version
    from public.presentation_designs
    where slug = btrim(p_design_slug) and tier = p_style and status = 'published';
  end if;

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
    v_template, v_palette, v_design_id, v_design_version
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
$function$;

/**
 * Failing a generation gives the week back.
 *
 * Everything else here is the original untouched — the service-role check, the
 * cancelled short-circuit, `stage`, `heartbeat_at`, the exact refund key and
 * message. Rewriting it from memory dropped three of those on the first
 * attempt; this is the original with one branch added.
 */
create or replace function public.fail_generation(
  p_job_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'generation job not found' using errcode = 'P0002'; end if;
  if v_job.status in ('failed', 'cancelled', 'succeeded') then return; end if;
  select * into v_wallet from public.credit_wallets where user_id = v_job.owner_id for update;

  update public.credit_wallets
    set balance = balance + v_job.reserved_credits,
        reserved = reserved - v_job.reserved_credits,
        version = version + 1
    where user_id = v_job.owner_id;

  if v_job.reserved_credits > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'refund', v_job.reserved_credits, -v_job.reserved_credits,
      v_wallet.balance + v_job.reserved_credits, v_wallet.reserved - v_job.reserved_credits,
      'failure-refund:' || v_job.id::text, 'Generation failure refund',
      jsonb_build_object('error_code', left(coalesce(p_error_code, 'generation_failed'), 120))
    ) on conflict (user_id, idempotency_key) do nothing;
  else
    -- Nothing was reserved, so it was a member's week that paid for this. A
    -- crash of ours must not cost somebody one of their four.
    perform public.quota_release('presentation_weekly', 1, v_job.owner_id);
  end if;

  update public.generation_jobs
    set status = 'failed', stage = 'failed', reserved_credits = 0,
        error_code = left(coalesce(p_error_code, 'generation_failed'), 120),
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000),
        completed_at = now(), heartbeat_at = now()
    where id = v_job.id;
  update public.presentations
    set status = 'failed', reserved_credits = 0,
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000)
    where id = v_job.presentation_id;
end;
$$;

revoke all on function public.fail_generation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_generation(uuid, text, text) to service_role;
