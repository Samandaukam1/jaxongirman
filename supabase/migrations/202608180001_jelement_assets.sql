-- An element can be a picture.
--
-- The library was built on the premise that an element is geometry: components
-- with boxes and colour tokens, drawn by the renderer, recoloured by changing a
-- token. That premise is right for a chart or a diagram and wrong for what this
-- library is actually being filled with — rendered CGI of a book, a bust, a
-- fountain pen, with studio lighting and contact shadows. Asked to describe one
-- of those as boxes and paths, an analyzer produces something unrecognisable,
-- and no amount of improving the prompt changes that: the format cannot hold
-- the picture.
--
-- So an element may instead carry the render itself. `asset_path` has existed
-- since the library shipped — the renderer's own comment pointed at it — but
-- nothing ever wrote to it and the two things that make it usable were missing.
--
-- The first is knowing what colour the asset already is. Recolouring means
-- moving one hue to another, and you cannot move a hue you have not measured,
-- so the accent is detected when the sheet is cut up and stored beside the file.
--
-- The second is that a phone cannot recolour a PNG. Neither can a PPTX. So the
-- variants are produced once, in the admin's browser, at the moment the sheet
-- is sliced — one file per accent a design might ask for — and everything
-- downstream picks a URL instead of processing pixels. A deck in amber gets the
-- amber file; nothing anywhere has to decode an image.

alter table public.jelements
  add column if not exists asset_accent_hue numeric,
  add column if not exists asset_variants jsonb not null default '{}'::jsonb;

comment on column public.jelements.asset_path is
  'The rendered image for this element, in `jelement-assets`. Present when the element is a picture rather than geometry; `geometry.components` may then be empty.';
comment on column public.jelements.asset_accent_hue is
  'The accent hue measured in the original file, 0-360. What a recolour shifts away from.';
comment on column public.jelements.asset_variants is
  'Pre-rendered recolours, keyed by target hue: {"45": "family/element-45.png"}. Produced at import, because a phone and a PPTX can only fetch a file.';

/**
 * Where the pictures live.
 *
 * Public, like `design-previews` and for the same reason: these are library
 * artwork shown in the style picker and drawn onto slides by three different
 * renderers, two of which have no session to sign a URL with. Nothing private
 * is ever stored here.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jelement-assets', 'jelement-assets', true, 10485760,
  array['image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists jelement_assets_public_read on storage.objects;
create policy jelement_assets_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'jelement-assets');

drop policy if exists jelement_assets_admin_write on storage.objects;
create policy jelement_assets_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'jelement-assets' and (select public.is_admin()));

drop policy if exists jelement_assets_admin_update on storage.objects;
create policy jelement_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'jelement-assets' and (select public.is_admin()))
  with check (bucket_id = 'jelement-assets' and (select public.is_admin()));

drop policy if exists jelement_assets_admin_delete on storage.objects;
create policy jelement_assets_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'jelement-assets' and (select public.is_admin()));

/**
 * Attaches a picture to one element.
 *
 * Separate from `admin_save_jelement_family` because the two happen at
 * different times and for different reasons: the specification is written once
 * and the artwork is attached, replaced and re-cut afterwards. Folding them
 * together would mean re-sending a thousand-line document to change one file.
 *
 * The aspect ratio comes with it. A trimmed object has whatever proportions it
 * has, and the placement code reads `geometry.aspectRatio` — leaving that at
 * the value the analyzer guessed would draw every picture stretched.
 */
create or replace function public.admin_set_jelement_asset(
  p_element_id uuid,
  p_asset_path text,
  p_accent_hue numeric default null,
  p_variants jsonb default '{}'::jsonb,
  p_aspect_ratio numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.jelements
     set asset_path = p_asset_path,
         asset_accent_hue = p_accent_hue,
         asset_variants = coalesce(p_variants, '{}'::jsonb),
         geometry = case
           when p_aspect_ratio is null or p_aspect_ratio <= 0 then geometry
           else jsonb_set(geometry, '{aspectRatio}', to_jsonb(p_aspect_ratio))
         end,
         updated_at = now()
   where id = p_element_id;

  if not found then
    raise exception 'element not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_jelement_asset(uuid, text, numeric, jsonb, numeric) from public, anon;
grant execute on function public.admin_set_jelement_asset(uuid, text, numeric, jsonb, numeric) to authenticated;
