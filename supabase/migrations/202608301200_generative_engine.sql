-- The generative design engine, recorded on the decks it made.
--
-- Additive only. Every existing presentation keeps `design_engine` null, which
-- is what the renderer already assumes: a deck laid out by JSLAYD. Nothing is
-- dropped, nothing is rewritten, and switching the engine off leaves every
-- deck made by it readable exactly as it is.

alter table public.presentations
  add column if not exists design_engine text,
  add column if not exists design_dna jsonb;

comment on column public.presentations.design_engine is
  'Which engine laid this deck out: null for JSLAYD, ''generative_v1'' for a deck composed per slide. Never inferred — a deck that does not say was made before the engine existed.';

comment on column public.presentations.design_dna is
  'The visual language a generative deck was built in: direction, palette, font pairing. Kept so a deck can be explained, and re-rendered, long after the run.';

-- The two switches an operator needs, defaulted to the state the brief asks
-- for: the new engine on, the old templates restricted. Written only if absent,
-- so re-running this migration cannot undo somebody's choice.
insert into public.app_settings (key, value, description)
values
  (
    'design.generative_enabled',
    'true'::jsonb,
    'Yangi taqdimotlar generativ dizayn engine bilan qurilsinmi.'
  ),
  (
    'design.legacy_restricted',
    'true'::jsonb,
    'Oldindan biriktirilgan JSLAYD dizaynlari va PPTX shablonlari generatsiyada ishlatilmasin.'
  )
on conflict (key) do nothing;
