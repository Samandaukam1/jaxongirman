-- The author's own pictures, put on their slides.
--
-- When a deck is ordered, the author may add up to six photographs with a
-- caption each. The phone shrinks every one (about 1600 px, JPEG) and puts it
-- straight into the deck's own folder in `presentation-assets`, where the
-- slides that show it will read it. There is no library and no second copy:
-- the picture lives exactly as long as the deck — `delete-work` empties that
-- folder — and a picture the deck ended up not using is removed by the
-- pipeline as soon as the deck is built.
--
-- Until now only the server wrote to this bucket. Members get one narrow way
-- in: their own folder, a `source-N.jpg` name under a deck id, insert and
-- delete only. No update, so nothing already there — an imported deck's
-- pictures, a generated image — can be overwritten from a phone.

drop policy if exists presentation_assets_source_image_insert on storage.objects;
create policy presentation_assets_source_image_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'presentation-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/source-[1-6]\.jpg$'
  );

-- The phone takes back what it uploaded when the order then fails to start.
drop policy if exists presentation_assets_source_image_delete on storage.objects;
create policy presentation_assets_source_image_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'presentation-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/source-[1-6]\.jpg$'
  );
