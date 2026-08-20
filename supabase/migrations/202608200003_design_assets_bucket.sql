/**
 * Where a design's own pictures live.
 *
 * A template's logo, texture or cover photograph is part of the composition,
 * not a place to put something. Until now there was nowhere to keep one: the
 * importer read them and threw them away, so an imported design arrived without
 * the artwork it was built around.
 *
 * Public, like the font bucket, because every renderer fetches them — the
 * phone, the web preview, the PDF exporter, the PPTX exporter — and a signed
 * URL that expires is a design that stops drawing after an hour. Nothing
 * private goes here: an admin uploads it deliberately as part of a design that
 * is itself published.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-assets', 'design-assets', true, 12582912, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/** Anyone may read a published design's artwork; only an admin may put it there. */
drop policy if exists design_assets_read on storage.objects;
create policy design_assets_read on storage.objects
  for select to public
  using (bucket_id = 'design-assets');

drop policy if exists design_assets_write on storage.objects;
create policy design_assets_write on storage.objects
  for all to authenticated
  using (bucket_id = 'design-assets' and (select public.is_admin()))
  with check (bucket_id = 'design-assets' and (select public.is_admin()));
