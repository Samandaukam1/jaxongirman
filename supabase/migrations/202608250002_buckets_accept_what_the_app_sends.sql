/**
 * Two bucket allow-lists that do not match what the app actually uploads.
 *
 * A bucket's allow-list is invisible from the app. When it refuses, storage
 * complains about a MIME type the person never chose and the screen says the
 * button failed — so these are not "an upload error", they are a feature that
 * has never worked and cannot be debugged from the outside.
 *
 * `user-uploads` has never accepted a PowerPoint file. The import screen has
 * always uploaded one there. So importing a deck failed on the first step, for
 * everyone, since the day it shipped.
 *
 * `exports` lost XLSX and CSV when it was widened for DOCX — the update
 * rewrote the array instead of adding to it, and took the survey exports with
 * it. Both are listed again below.
 *
 * The lists are written out in full on purpose. `array_append` would leave the
 * true contents spread across however many migrations touched them, and the
 * next person widening one would have the same accident.
 */

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  -- The deck a person brings in from PowerPoint.
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/jpeg', 'image/png', 'image/webp'
]
where id = 'user-uploads';

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  -- Survey results, which export as a spreadsheet or a plain CSV.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
]
where id = 'exports';
