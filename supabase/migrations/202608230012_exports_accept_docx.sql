/**
 * The exports bucket accepts Word documents.
 *
 * It was created when the only things this app produced were a PDF and a
 * PowerPoint file, and its allow-list says exactly that. An obyektivka and an
 * academic work are DOCX, and storage refused them — which the person read as
 * "Server operation failed", because a bucket's refusal has nothing to do with
 * the button they pressed.
 */

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'exports';
