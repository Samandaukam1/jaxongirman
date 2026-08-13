-- A font is a family, not a file.
--
-- Each of the four slots held exactly one file, because `unique (design_id,
-- font_id)` said so. That is not what a typeface is: Regular, Medium, SemiBold,
-- Bold and their italics are separate files of the same family, and a design
-- that uses two weights needs both present or the renderer synthesises the
-- second by smearing the first — which is what "faux bold" is, and it looks it.
--
-- So a slot becomes a package of up to ten faces, keyed by weight and slope.
-- Nothing about the four slots changes: elements still reference `font_1`, and a
-- design that ships one file still ships one face.

alter table public.presentation_design_fonts
  drop constraint if exists presentation_design_fonts_design_id_font_id_key;

-- A face is identified by its weight and its slope. Uploading 700 twice
-- replaces it rather than accumulating; uploading 700 italic adds a face.
alter table public.presentation_design_fonts
  add constraint presentation_design_fonts_face_key unique (design_id, font_id, weight, italic);

/**
 * Ten per package.
 *
 * Enough for a full family — 100 through 900 is nine weights, and italics of
 * the ones a deck actually uses — and few enough that a runaway upload cannot
 * fill the bucket. Enforced here rather than in the console because the console
 * is not the only thing that could ever write.
 */
create or replace function public.presentation_design_fonts_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.presentation_design_fonts
    where design_id = new.design_id and font_id = new.font_id
  ) > 10 then
    raise exception 'font_package_full' using errcode = '23514',
      detail = 'Bitta shrift paketiga eng ko‘pi 10 ta fayl kiritiladi.';
  end if;
  return null;
end;
$$;

drop trigger if exists presentation_design_fonts_cap on public.presentation_design_fonts;
create constraint trigger presentation_design_fonts_cap
  after insert on public.presentation_design_fonts
  deferrable initially immediate
  for each row execute function public.presentation_design_fonts_cap();

/* -------------------------------------------------------------------- RPCs */

-- Saves one face of one package.
--
-- The package's name, roles and fallback belong to the family rather than to
-- any single file, so setting them on one face sets them on all of them: two
-- faces of the same font disagreeing about their own name is not a state worth
-- being able to reach.
create or replace function public.admin_save_design_font(
  p_design_id uuid,
  p_font_id text,
  p_name text,
  p_roles text[],
  p_file_name text,
  p_format text,
  p_weight integer default 400,
  p_italic boolean default false,
  p_fallback text default 'Manrope',
  p_byte_size integer default null,
  p_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_slug text;
  v_id uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select slug into v_slug from public.presentation_designs where id = p_design_id;
  if v_slug is null then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;
  -- An object key, never a path: the bucket prefix is the design's own slug and
  -- nothing the caller sends may climb out of it (§82).
  if p_file_name is not null and p_file_name ~ '[/\\]|\.\.' then
    raise exception 'unsafe_asset' using errcode = '22023';
  end if;

  insert into public.presentation_design_fonts as font (
    design_id, font_id, name, roles, asset_path, format, weight, italic, fallback, byte_size, checksum
  )
  values (
    p_design_id, p_font_id, coalesce(p_name, ''), coalesce(p_roles, '{}'),
    case when p_file_name is null then null else v_slug || '/' || p_file_name end,
    p_format, coalesce(p_weight, 400), coalesce(p_italic, false), coalesce(p_fallback, 'Manrope'),
    p_byte_size, p_checksum
  )
  on conflict (design_id, font_id, weight, italic) do update set
    name = excluded.name,
    roles = excluded.roles,
    asset_path = coalesce(excluded.asset_path, font.asset_path),
    format = coalesce(excluded.format, font.format),
    fallback = excluded.fallback,
    byte_size = excluded.byte_size,
    checksum = excluded.checksum
  returning font.id into v_id;

  -- The family's own properties, kept identical across its faces.
  update public.presentation_design_fonts set
    name = coalesce(p_name, ''),
    roles = coalesce(p_roles, '{}'),
    fallback = coalesce(p_fallback, 'Manrope')
  where design_id = p_design_id and font_id = p_font_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.font_saved', 'presentation_design', p_design_id::text,
    jsonb_build_object('font_id', p_font_id, 'format', p_format,
      'weight', coalesce(p_weight, 400), 'italic', coalesce(p_italic, false)));

  return v_id;
end;
$$;

-- Removing one face, so a wrong upload can be taken back without dropping the
-- whole family and starting again.
create or replace function public.admin_remove_design_font(
  p_design_id uuid,
  p_font_id text,
  p_weight integer,
  p_italic boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_path text;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.presentation_design_fonts
  where design_id = p_design_id and font_id = p_font_id
    and weight = p_weight and italic = coalesce(p_italic, false)
  returning asset_path into v_path;
  if not found then
    raise exception 'font_face_not_found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.font_removed', 'presentation_design', p_design_id::text,
    jsonb_build_object('font_id', p_font_id, 'weight', p_weight, 'italic', coalesce(p_italic, false)));

  -- The object key, so the caller can delete the file it just detached.
  return v_path;
end;
$$;

revoke all on function public.admin_remove_design_font(uuid, text, integer, boolean) from public, anon;
grant execute on function public.admin_remove_design_font(uuid, text, integer, boolean) to authenticated;
