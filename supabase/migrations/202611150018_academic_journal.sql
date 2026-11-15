-- Scientific works, made to a journal's requirements (Jaxongirman.app 2.0, §5.6).
--
-- A work now carries what a journal asks of the paper around its prose: the
-- language it is written in; for an article, the structure the person chose
-- (IMRAD, ILMRAD, a review, a case study, a short communication, a
-- theoretical article); the authors with their organisations, ORCID iDs and
-- e-mail; the UDC code; acknowledgements and the funding source, which are
-- the person's own words or nothing; the citation style the bibliography is
-- printed in; and the layout — font size, line spacing, margins.
--
-- And the person may now correct what was written before downloading it, and
-- add their own figures. That reverses one decision of 202608230011, which
-- kept sections out of a client's reach. The reason given there — the text is
-- the generator's work against real sources — still holds for the sources and
-- for the paying, which stay the server's; but the prose is the person's paper,
-- and a paper its author cannot correct is not theirs. They edit through one
-- function, which keeps the edit to the text of a section already written.

alter table public.academic_works
  add column if not exists language text not null default 'uz',
  add column if not exists structure text,
  add column if not exists citation_style text not null default 'gost',
  add column if not exists authors jsonb not null default '[]'::jsonb,
  add column if not exists udc text not null default '',
  add column if not exists acknowledgements text not null default '',
  add column if not exists funding text not null default '',
  add column if not exists layout jsonb not null default '{}'::jsonb;

alter table public.academic_works
  drop constraint if exists academic_works_language,
  drop constraint if exists academic_works_structure,
  drop constraint if exists academic_works_citation_style,
  drop constraint if exists academic_works_authors,
  drop constraint if exists academic_works_extras,
  drop constraint if exists academic_works_layout;
alter table public.academic_works
  add constraint academic_works_language check (language in ('uz', 'ru', 'en', 'tr')),
  add constraint academic_works_structure check (
    structure is null or (kind = 'article' and structure in ('imrad', 'ilmrad', 'review', 'case_study', 'short', 'theoretical'))),
  add constraint academic_works_citation_style check (citation_style in ('apa', 'gost', 'mla', 'chicago', 'ieee', 'vancouver')),
  add constraint academic_works_authors check (jsonb_typeof(authors) = 'array' and jsonb_array_length(authors) <= 10),
  add constraint academic_works_extras check (
    char_length(udc) <= 60 and char_length(acknowledgements) <= 3000 and char_length(funding) <= 3000),
  add constraint academic_works_layout check (jsonb_typeof(layout) = 'object');

comment on column public.academic_works.structure is
  'An article''s structure, chosen by the person: imrad, ilmrad, review, case_study, short, theoretical. Null for other kinds and for older articles (then decided by `empirical`).';
comment on column public.academic_works.authors is
  '[{name, affiliation, orcid, email}], in the order they are printed. Up to ten.';
comment on column public.academic_works.layout is
  '{preset uz|journal|apa, fontSize, lineSpacing, margins {top,right,bottom,left} cm, indent cm, pageNumbers}.';

alter table public.academic_sections
  add column if not exists figures jsonb not null default '[]'::jsonb,
  add column if not exists edited_at timestamptz;
alter table public.academic_sections drop constraint if exists academic_sections_figures;
alter table public.academic_sections
  add constraint academic_sections_figures check (jsonb_typeof(figures) = 'array' and jsonb_array_length(figures) <= 6);
comment on column public.academic_sections.figures is
  'The person''s own figures after the section''s text: [{path, caption, width, height}] — path in user-uploads under <owner>/ilmiy/<work>/.';

/** The owner's section, locked for the change. */
create or replace function public.academic_own_section(p_section_id uuid)
returns public.academic_sections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section public.academic_sections%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_section from public.academic_sections where id = p_section_id for update;
  if not found or v_section.owner_id <> auth.uid() then
    raise exception 'Bo‘lim topilmadi.' using errcode = 'P0002';
  end if;
  return v_section;
end;
$$;
revoke all on function public.academic_own_section(uuid) from public, anon, authenticated;

/**
 * The author corrects a section. Only one already written: an unwritten one is
 * the generator's to fill, and paying for it stays where it is.
 */
create or replace function public.academic_section_edit(p_section_id uuid, p_heading text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section public.academic_sections%rowtype := public.academic_own_section(p_section_id);
  v_heading text := left(btrim(coalesce(p_heading, '')), 200);
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_section.status <> 'ready' then
    raise exception 'Bo‘lim hali yozilmagan.' using errcode = '22023';
  end if;
  if char_length(v_heading) < 1 then raise exception 'Sarlavhani yozing.' using errcode = '22023'; end if;
  if char_length(v_body) < 1 then raise exception 'Bo‘lim matni bo‘sh bo‘lmasin.' using errcode = '22023'; end if;
  if char_length(v_body) > 24000 then raise exception 'Bo‘lim juda uzun.' using errcode = '22023'; end if;
  update public.academic_sections set
    heading = v_heading,
    body = v_body,
    words = coalesce(array_length(regexp_split_to_array(v_body, '\s+'), 1), 0),
    edited_at = now()
    where id = v_section.id
    returning * into v_section;
  update public.academic_works set updated_at = now() where id = v_section.work_id;
  return jsonb_build_object('id', v_section.id, 'heading', v_section.heading, 'body', v_section.body, 'words', v_section.words);
end;
$$;

/**
 * The author's own figures for a section: pictures they uploaded to their
 * folder for this work, each with its caption. Numbered across the document
 * when it is printed.
 */
create or replace function public.academic_section_figures(p_section_id uuid, p_figures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section public.academic_sections%rowtype := public.academic_own_section(p_section_id);
  v_folder text := v_section.owner_id::text || '/ilmiy/' || v_section.work_id::text || '/';
  v_clean jsonb := '[]'::jsonb;
  v_figure jsonb;
begin
  if p_figures is null or jsonb_typeof(p_figures) <> 'array' or jsonb_array_length(p_figures) > 6 then
    raise exception 'Bir bo‘limga ko‘pi bilan 6 ta rasm.' using errcode = '22023';
  end if;
  for v_figure in select * from jsonb_array_elements(p_figures) loop
    if coalesce(v_figure ->> 'path', '') not like v_folder || '%' or (v_figure ->> 'path') like '%..%' then
      raise exception 'Rasm bu ishning papkasida emas.' using errcode = '42501';
    end if;
    if coalesce((v_figure ->> 'width')::numeric, 0) <= 0 or coalesce((v_figure ->> 'height')::numeric, 0) <= 0 then
      raise exception 'Rasm o‘lchami noma’lum.' using errcode = '22023';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'path', v_figure ->> 'path',
      'caption', left(btrim(coalesce(v_figure ->> 'caption', '')), 300),
      'width', (v_figure ->> 'width')::numeric,
      'height', (v_figure ->> 'height')::numeric));
  end loop;
  update public.academic_sections set figures = v_clean, edited_at = now() where id = v_section.id;
  update public.academic_works set updated_at = now() where id = v_section.work_id;
  return v_clean;
end;
$$;

revoke all on function public.academic_section_edit(uuid, text, text) from public, anon;
revoke all on function public.academic_section_figures(uuid, jsonb) from public, anon;
grant execute on function public.academic_section_edit(uuid, text, text) to authenticated;
grant execute on function public.academic_section_figures(uuid, jsonb) to authenticated;
