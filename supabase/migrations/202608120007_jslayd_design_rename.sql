-- Editing a design by identity, so a rename stays one design.
--
-- `admin_save_design` matched an existing design by slug alone. That was right
-- while the only way to reach the editor was to create something new, but every
-- design is editable now — including the fifteen translated from the old
-- `slide_templates`, which had no prompt to open until the decompiler existed.
--
-- Slug-only matching means editing a design and correcting its slug quietly
-- writes a second design and leaves the first behind, published, under the old
-- name. Nobody is told. The admin sees their edit saved and the users keep
-- getting the old one.
--
-- Presentations reference a design by `design_id`, never by slug (see
-- `presentations.design_id`), so renaming does not touch a single existing
-- deck. The generator's `p_design_slug` is a choice made at generation time,
-- not a stored link.
--
-- The old signature is dropped rather than left beside the new one: two
-- overloads differing only by a trailing defaulted argument make PostgREST's
-- resolution depend on exactly which keys a client happens to send.

drop function if exists public.admin_save_design(
  text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text);

create function public.admin_save_design(
  p_slug text,
  p_name text,
  p_tier public.presentation_style,
  p_description text default '',
  p_is_premium boolean default false,
  p_source_prompt text default '',
  p_compiled_config jsonb default null,
  p_preview jsonb default '{}'::jsonb,
  p_content_hash text default null,
  p_health_score integer default null,
  p_thumbnail_path text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
  v_before jsonb;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_compiled_config is not null and p_compiled_config->>'format' is distinct from 'JSLAYD' then
    raise exception 'not_a_jslayd_document' using errcode = '22023';
  end if;
  -- 4 MB matches the document ceiling the compiler enforces; a payload past it
  -- is either a mistake or an attempt to fill the table (§82).
  if p_compiled_config is not null and pg_column_size(p_compiled_config) > 4194304 then
    raise exception 'document_too_large' using errcode = '22023';
  end if;

  -- The design being edited, if the console named one. A caller may not invent
  -- an id: an unknown one is a stale editor tab, and silently creating a design
  -- under it would hide the fact that the original is gone.
  if p_id is not null then
    select to_jsonb(design) into v_before from public.presentation_designs design where id = p_id;
    if v_before is null then
      raise exception 'design_not_found' using errcode = '02000';
    end if;
  else
    select to_jsonb(design) into v_before from public.presentation_designs design where slug = p_slug;
  end if;

  -- A rename must not land on a slug another design already answers to.
  if p_id is not null and exists (
    select 1 from public.presentation_designs where slug = p_slug and id <> p_id
  ) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;

  if p_id is not null then
    update public.presentation_designs as design set
      slug = p_slug,
      name = p_name,
      tier = p_tier,
      description = coalesce(p_description, ''),
      is_premium = coalesce(p_is_premium, false),
      source_prompt = coalesce(p_source_prompt, ''),
      compiled_config = p_compiled_config,
      preview = coalesce(p_preview, '{}'::jsonb),
      content_hash = p_content_hash,
      health_score = p_health_score,
      thumbnail_path = coalesce(p_thumbnail_path, design.thumbnail_path)
    where design.id = p_id
    returning design.id into v_id;
  else
    insert into public.presentation_designs as design (
      slug, name, tier, description, is_premium, source_prompt,
      compiled_config, preview, content_hash, health_score, thumbnail_path, created_by
    )
    values (
      p_slug, p_name, p_tier, coalesce(p_description, ''), coalesce(p_is_premium, false), coalesce(p_source_prompt, ''),
      p_compiled_config, coalesce(p_preview, '{}'::jsonb), p_content_hash, p_health_score, p_thumbnail_path, v_admin
    )
    on conflict (slug) do update set
      name = excluded.name,
      tier = excluded.tier,
      description = excluded.description,
      is_premium = excluded.is_premium,
      source_prompt = excluded.source_prompt,
      compiled_config = excluded.compiled_config,
      preview = excluded.preview,
      content_hash = excluded.content_hash,
      health_score = excluded.health_score,
      thumbnail_path = coalesce(excluded.thumbnail_path, design.thumbnail_path)
    returning design.id into v_id;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (
    v_admin,
    case when v_before is null then 'design.created' else 'design.edited' end,
    'presentation_design', v_id::text, v_before,
    jsonb_build_object('slug', p_slug, 'name', p_name, 'tier', p_tier, 'content_hash', p_content_hash)
  );

  return v_id;
end;
$$;

revoke all on function public.admin_save_design(
  text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text, uuid) from public, anon;
grant execute on function public.admin_save_design(
  text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text, uuid) to authenticated;
