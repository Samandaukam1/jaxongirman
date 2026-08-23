/**
 * Academic writing: an article, an independent work, a referat, a course paper.
 *
 * Four documents that differ in their structure and their length and in almost
 * nothing else, so they are one table with a `kind` rather than four tables
 * that would drift.
 *
 * The important decision is that a work is stored **section by section**. A
 * twenty-page paper written in one request is a request that fails at page
 * nineteen and leaves nothing; written a section at a time, a failure costs one
 * section and the work resumes from where it stopped. That is also what makes
 * the coin rule in the brief possible — a balance is checked before each paid
 * section, and running out pauses the work with everything written so far still
 * there, rather than refunding a person for a document they no longer have.
 */

create table if not exists public.academic_works (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('article', 'independent', 'referat', 'coursework')),
  topic text not null,
  field text not null default '',
  /** Free-text requirements from the person: length, style, what to include. */
  requirements text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'planning', 'writing', 'paused', 'ready', 'failed')),
  /**
   * Whether the topic supports an empirical structure.
   *
   * An article about something nobody here ran an experiment on must not have a
   * Results section, because filling one in means inventing findings. The
   * planner decides this once and the writer obeys it.
   */
  empirical boolean not null default false,
  /** The sources the research stage actually found. Never invented. */
  sources jsonb not null default '[]'::jsonb,
  estimated_credits integer not null default 0,
  spent_credits integer not null default 0,
  paused_reason text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academic_works_owner_idx
  on public.academic_works (owner_id, updated_at desc);

create trigger academic_works_set_updated_at
  before update on public.academic_works
  for each row execute function public.set_updated_at();

create table if not exists public.academic_sections (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.academic_works(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  position integer not null,
  /** `introduction`, `methods`, `chapter_1` … — stable across a regeneration. */
  key text not null,
  heading text not null,
  /** What this section is for, written by the planner and read by the writer. */
  brief text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'writing', 'ready', 'failed')),
  body text not null default '',
  /** Which of the work's sources this section actually leaned on. */
  citations jsonb not null default '[]'::jsonb,
  words integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, key)
);

create index if not exists academic_sections_work_idx
  on public.academic_sections (work_id, position);

create trigger academic_sections_set_updated_at
  before update on public.academic_sections
  for each row execute function public.set_updated_at();

alter table public.academic_works enable row level security;
alter table public.academic_sections enable row level security;

/**
 * A person creates and deletes their own work and reads its sections; the
 * server writes the prose.
 *
 * No client insert or update on `academic_sections`: what is in them is what
 * the generator produced against real sources, and a client that could write
 * there could put anything into a document the app presents as its own work.
 */
drop policy if exists academic_works_owner_all on public.academic_works;
create policy academic_works_owner_all on public.academic_works
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists academic_sections_owner_select on public.academic_sections;
create policy academic_sections_owner_select on public.academic_sections
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists academic_sections_owner_delete on public.academic_sections;
create policy academic_sections_owner_delete on public.academic_sections
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.academic_works to authenticated;
grant select, delete on public.academic_sections to authenticated;

/**
 * What the two paid stages cost.
 *
 * Added to the table the spend engine already reads, so research and a section
 * are priced the same way every other operation is and an admin changes them in
 * the same place.
 */
update public.app_settings
set value = value
  || jsonb_build_object(
       'academic_research', jsonb_build_object('base_credits', 40,
         'label', 'Ilmiy ish uchun manba izlash'),
       'academic_section', jsonb_build_object('base_credits', 25,
         'label', 'Ilmiy ishning bir bo‘limi'))
where key = 'credits.operation_costs';
