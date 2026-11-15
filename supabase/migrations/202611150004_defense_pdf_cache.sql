-- The defence script's PDF, kept.
--
-- Downloading the script drew every slide and set the whole document again,
-- each time — slow, and to the person it looked like the script was being
-- written again. Now the finished file's place is kept beside the script, and
-- the phone takes it straight from storage while it is current: rendered after
-- the deck last changed, and not cleared by a rewrite of the script (writing
-- the script clears both columns, so a new text always gets a new file).

alter table public.presentation_defenses
  add column if not exists pdf_path text,
  add column if not exists pdf_rendered_at timestamptz;

comment on column public.presentation_defenses.pdf_path is
  'Storage path (exports bucket) of the rendered script PDF; null until rendered, cleared when the script is rewritten.';
comment on column public.presentation_defenses.pdf_rendered_at is
  'When pdf_path was rendered; current while it is after the deck''s updated_at.';
