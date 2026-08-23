/**
 * What to say while the deck is on the screen.
 *
 * A slide carries three bullet points because three bullet points is what a
 * slide is for. The person standing beside it has to talk for a minute about
 * each, and the deck does not tell them how — so they either read the bullets
 * aloud, which is the worst version of a presentation, or they write the speech
 * themselves, which is the work the deck was supposed to save.
 *
 * So every generated deck gets one: an opening, a passage per slide, and a
 * close. It is not the slide text again — the slides are deliberately short and
 * this is deliberately not.
 *
 * One row per presentation. Regenerating replaces it, because two versions of
 * what to say is worse than one: the point of it is to be the thing you read
 * on the morning.
 */

create table if not exists public.presentation_defenses (
  presentation_id uuid primary key references public.presentations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  /** The opening, before any slide is discussed. */
  introduction text not null default '',
  /** The close, after the last one. */
  conclusion text not null default '',
  /**
   * One entry per slide:
   * `{slide_number, slide_title, speaker_text, key_point, transition_to_next}`.
   *
   * Stored whole rather than as rows. It is read in one piece, written in one
   * piece and replaced in one piece; a table of sections would be five joins
   * for a document nobody edits a paragraph of.
   */
  sections jsonb not null default '[]'::jsonb,
  /**
   * Which version of the deck this was written for.
   *
   * A deck edited after its script was written has a script that describes
   * slides that no longer say what it claims. Comparing this to the deck's
   * `updated_at` is how the screen knows to offer "yangilash" rather than
   * silently showing something stale.
   */
  written_for timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presentation_defenses_owner_idx
  on public.presentation_defenses (owner_id);

create trigger presentation_defenses_set_updated_at
  before update on public.presentation_defenses
  for each row execute function public.set_updated_at();

alter table public.presentation_defenses enable row level security;

/**
 * A person reads and deletes their own; only the server writes one.
 *
 * There is no insert or update policy on purpose. The script is written by the
 * generator under the service role, and a client that could write here could
 * put anything in a document the app presents as its own work.
 */
drop policy if exists presentation_defenses_owner_select on public.presentation_defenses;
create policy presentation_defenses_owner_select on public.presentation_defenses
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists presentation_defenses_owner_delete on public.presentation_defenses;
create policy presentation_defenses_owner_delete on public.presentation_defenses
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, delete on public.presentation_defenses to authenticated;
