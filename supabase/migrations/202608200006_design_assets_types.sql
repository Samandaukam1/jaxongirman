/**
 * The picture formats a template actually ships.
 *
 * The bucket accepted four; a real deck also carries GIF and BMP, and refusing
 * them at upload meant a design whose artwork was read correctly and then had
 * nowhere to go. Metafiles are deliberately still absent — nothing here can
 * draw one, so storing it would be storing a file no renderer will ever fetch.
 */
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif', 'image/bmp'
]
where id = 'design-assets';
