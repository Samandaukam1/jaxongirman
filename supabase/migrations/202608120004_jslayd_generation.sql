-- Two things: a latent read failure in the design catalogue, and the wiring
-- that lets a user actually pick a JSLAYD design.

-- ------------------------------------------------------- the read failure --
--
-- `using (is_active or public.is_admin())` looks like it lets a signed-out
-- reader see the active catalogue. It does not: `anon` holds no EXECUTE on
-- `is_admin`, and Postgres checks a function's ACL when the expression is
-- initialised rather than per row, so the OR never gets a chance to
-- short-circuit. Every read of these two tables as `anon` fails outright:
--
--   set role anon; select count(*) from public.slide_templates;
--   ERROR:  permission denied for function is_admin
--
-- Nothing reaches it today — the app reads with a session, and the projector
-- goes through an edge function — so this is a grant that says the opposite of
-- what the code means rather than a live outage. Splitting the policy by role
-- makes the rule true by construction instead of by evaluation order.
drop policy if exists palette_families_read on public.palette_families;
drop policy if exists slide_templates_read on public.slide_templates;

create policy palette_families_public_read on public.palette_families
  for select to anon using (is_active);
create policy palette_families_read on public.palette_families
  for select to authenticated using (is_active or (select public.is_admin()));

create policy slide_templates_public_read on public.slide_templates
  for select to anon using (is_active);
create policy slide_templates_read on public.slide_templates
  for select to authenticated using (is_active or (select public.is_admin()));

-- ------------------------------------------------------- design selection --
--
-- `start_generation` gains one optional argument. A deck that names a published
-- JSLAYD design is laid out by it; a deck that does not is laid out exactly as
-- it always was, by the built-in blueprint. The template and palette are still
-- resolved and recorded either way, because they are what the deck falls back
-- to if the design ever becomes unreadable (§72, §99).
drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text);

create or replace function public.start_generation(
  p_presentation_id uuid,
  p_topic text,
  p_title text,
  p_style public.presentation_style,
  p_slide_count integer,
  p_author_name text default null,
  p_teacher_name text default null,
  p_sources text[] default '{}'::text[],
  p_idempotency_key text default null,
  p_template_code text default null,
  p_palette_code text default null,
  p_design_slug text default null
)
returns table (presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
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

  v_estimate := public.estimate_presentation_credits(p_style, p_slide_count);
  select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'credit wallet not found' using errcode = 'P0002';
  end if;
  if v_wallet.balance < v_estimate then
    raise exception 'insufficient credits' using errcode = 'P0001', detail = format('required=%s available=%s', v_estimate, v_wallet.balance);
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

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;

revoke all on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text) from public, anon;
grant execute on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text) to authenticated;

-- ------------------------------------------------------- the admin listing --

create or replace function public.admin_list_designs(
  p_status public.jslayd_design_status default null,
  p_tier public.presentation_style default null,
  p_query text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  tier public.presentation_style,
  status public.jslayd_design_status,
  description text,
  is_premium boolean,
  is_featured boolean,
  sort_order integer,
  thumbnail_path text,
  health_score integer,
  published_version integer,
  archetype_count integer,
  font_count integer,
  used_by integer,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    design.id, design.slug, design.name, design.tier, design.status, design.description,
    design.is_premium, design.is_featured, design.sort_order, design.thumbnail_path,
    design.health_score, design.published_version,
    coalesce(jsonb_array_length(design.compiled_config->'archetypes'), 0)::integer,
    (select count(*)::integer from public.presentation_design_fonts font where font.design_id = design.id),
    (select count(*)::integer from public.presentations deck where deck.design_id = design.id),
    design.created_at, design.updated_at, design.published_at
  from public.presentation_designs design
  where public.is_admin()
    and (p_status is null or design.status = p_status)
    and (p_tier is null or design.tier = p_tier)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or design.name ilike '%' || btrim(p_query) || '%'
      or design.slug ilike '%' || btrim(p_query) || '%'
    )
  order by design.tier, design.sort_order, design.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_designs(public.jslayd_design_status, public.presentation_style, text, integer, integer) from public, anon;
grant execute on function public.admin_list_designs(public.jslayd_design_status, public.presentation_style, text, integer, integer) to authenticated;

-- Duplicating a design is how a variant starts (§80): same document, new slug,
-- back to draft, no version history inherited.
create or replace function public.admin_duplicate_design(p_design_id uuid, p_slug text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_source public.presentation_designs;
  v_id uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_source from public.presentation_designs where id = p_design_id;
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;

  insert into public.presentation_designs (
    slug, name, tier, description, is_premium, source_prompt,
    compiled_config, preview, content_hash, health_score, created_by
  ) values (
    p_slug, p_name, v_source.tier, v_source.description, v_source.is_premium, v_source.source_prompt,
    v_source.compiled_config, v_source.preview, v_source.content_hash, v_source.health_score, v_admin
  )
  returning id into v_id;

  -- Fonts point at the original's bucket prefix. Copying the rows would make
  -- two designs share files, so the duplicate starts with none and the admin
  -- re-uploads — which is also what stops a rename from silently breaking the
  -- design it was copied from.
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.duplicated', 'presentation_design', v_id::text,
    jsonb_build_object('from', v_source.slug, 'to', p_slug));

  return v_id;
end;
$$;

revoke all on function public.admin_duplicate_design(uuid, text, text) from public, anon;
grant execute on function public.admin_duplicate_design(uuid, text, text) to authenticated;
