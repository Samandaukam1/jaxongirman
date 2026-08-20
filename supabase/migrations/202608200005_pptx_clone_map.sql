/**
 * The way back from a generated slide to the slide it was cloned from.
 *
 * For a design imported from PowerPoint the export is not rendered — it is the
 * original package with new words in it. To write those words the exporter has
 * to know two things a JSLAYD document cannot carry: which part of the uploaded
 * file this page was, and which shape inside it each piece of copy belongs to.
 *
 * Stored on the profile rather than in the document because they are facts
 * about the source, not about the design: a document is the same whether or not
 * anyone still has the file it came from, and a renderer must never need either
 * of these.
 */
alter table public.design_slide_profiles
  add column if not exists source_slide_part text not null default '';

comment on column public.design_slide_profiles.source_slide_part is
  'e.g. `ppt/slides/slide4.xml` — the part cloned when this page is chosen.';

/**
 * Which shape each binding fills, as `[{binding, shapeId, elementId}]`.
 *
 * The generator resolves bindings; the cloner edits shapes. This is the only
 * thing that joins them, and without it every generated deck would have to be
 * re-parsed out of the original file to find out where its words go.
 */
alter table public.design_slide_profiles
  add column if not exists text_map jsonb not null default '[]'::jsonb;

alter table public.design_slide_profiles drop constraint if exists design_slide_profiles_text_map_shape;
alter table public.design_slide_profiles add constraint design_slide_profiles_text_map_shape check (
  jsonb_typeof(text_map) = 'array'
);

/** Which uploaded file a design's pages are cloned from, when there is one. */
alter table public.presentation_designs
  add column if not exists source_asset_path text;

comment on column public.presentation_designs.source_asset_path is
  'Object key in `design-source` for the .pptx these pages are cloned from.';
