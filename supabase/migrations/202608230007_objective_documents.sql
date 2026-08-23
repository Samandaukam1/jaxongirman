/**
 * The obyektivka a person fills in once and hands in many times.
 *
 * It is the same document every institution asks for and the same twenty
 * answers every time — which is why it is stored rather than downloaded and
 * forgotten. Next year's copy is this year's with two lines changed, and the
 * photograph is one they already made here.
 *
 * The document itself is not stored as a file. Files go stale the moment a
 * field changes and there is no way to tell which of three downloads is the
 * current one; the answers are the document, and DOCX and PDF are rendered from
 * them on demand.
 */

create table if not exists public.objective_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null default '',
  /** The labelled fields, keyed by the ids `objective.ts` binds the form to. */
  fields jsonb not null default '{}'::jsonb,
  /** `[{period, detail}]`, in the order they appear under MEHNAT FAOLIYATI. */
  work jsonb not null default '[]'::jsonb,
  /** `[{relation, name, born, work, address}]` — the second page. */
  relatives jsonb not null default '[]'::jsonb,
  /**
   * Which 3×4 sheet the photograph comes from.
   *
   * A reference rather than a copy: the person made it in this app, and a
   * second copy is a second thing to keep in step and to delete.
   */
  portrait_id uuid references public.portrait_sheets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists objective_documents_owner_idx
  on public.objective_documents (owner_id, updated_at desc);

create trigger objective_documents_set_updated_at
  before update on public.objective_documents
  for each row execute function public.set_updated_at();

alter table public.objective_documents enable row level security;

/** A person owns theirs outright: this one is data they typed, not output. */
drop policy if exists objective_documents_owner_all on public.objective_documents;
create policy objective_documents_owner_all on public.objective_documents
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.objective_documents to authenticated;
