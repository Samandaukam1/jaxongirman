-- JSLAYD color families live inside presentation_designs.compiled_config.
--
-- presentations.palette_code used to reference the retired global
-- palette_families catalogue. New JSLAYD decks store the selected colour-family
-- code from the design document itself, so that legacy foreign key rejects
-- perfectly valid JSLAYD palette codes.
--
-- Keep the column: old decks still carry their historic palette code and new
-- decks use it to pin the selected JSLAYD colour family.
-- Only remove the obsolete catalogue constraint.

alter table public.presentations
  drop constraint if exists presentations_palette_code_fkey;

comment on column public.presentations.palette_code is
  'Selected colour-family code. Legacy decks may contain a retired palette_families code; JSLAYD decks contain a family code from their pinned design document.';
