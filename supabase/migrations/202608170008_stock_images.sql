-- Photographs come from the web, not from a model.
--
-- Generated imagery is withdrawn from the product. A deck's pictures are now
-- either a licensed photograph found on the open web or an object from the
-- JElement library, and nothing on the generation path calls an image model.
--
-- The bucket is separate from `generated-images` because the two are not the
-- same thing and one of them is about to hold nothing new: a fetched
-- photograph carries a licence and an author, and storing it under a name that
-- says "generated" would make that impossible to see later.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stock-images', 'stock-images', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

/**
 * Readable by the person whose deck it is, like every other private bucket.
 *
 * Added to the existing policy's list rather than given a policy of its own:
 * one rule about who may read a presentation's assets is easier to keep true
 * than five.
 */
drop policy if exists storage_owner_select on storage.objects;
create policy storage_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = any (array['user-uploads', 'presentation-assets', 'generated-images', 'exports', 'thumbnails', 'stock-images'])
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

/**
 * Where a picture came from, so it can be credited.
 *
 * Openly licensed images carry conditions — most require the author to be
 * named. Storing the licence and the source alongside the file is what makes
 * honouring that possible at all; a file with no provenance is one nobody can
 * safely publish.
 *
 * On `presentation_assets.metadata` rather than in a table of its own: it is a
 * property of the asset, and a second table would be a join for something that
 * is never queried without its asset.
 */
comment on column public.presentation_assets.metadata is
  'Slide index, and for a stock photograph its licence, author, source URL and provider — the provenance needed to credit it.';
