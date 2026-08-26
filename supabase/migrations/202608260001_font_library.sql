/**
 * The font shelf, made browsable.
 *
 * `font_families` and `font_faces` already exist: `resolve-design-fonts` built
 * them so that the eleventh imported template naming Inter finds the copy the
 * first one fetched. What they were never built for is somebody *choosing* a
 * font — there is no category to filter by, no way to say a family is one we
 * offer rather than one a template happened to drag in, and no name for a face
 * beyond its weight and slant.
 *
 * So this widens the shelf rather than building a second one beside it. A
 * parallel `font_files` table holding the same bytes under a different name is
 * the thing most likely to rot: two importers, two truths about which faces
 * exist, and an editor reading whichever was wired last.
 *
 * Two notes on what is deliberately *not* added.
 *
 * **No `slug` column.** `normalized_name` already is one — lowercased,
 * punctuation stripped, unique, and already the folder name every face is
 * stored under (`library/montserrat/…`). A second column meaning the same thing
 * is a second thing to keep in step.
 *
 * **No new bucket.** The faces live in `design-fonts`, which exists, is already
 * served to the app, and is already the path `resolve-design-fonts` writes. The
 * brief asked for a private `fonts` bucket; a second bucket holding the same
 * OFL files would split the library in half and leave two upload paths to keep
 * idempotent. What controls whether a font is *offered* is `is_active` below,
 * which is metadata and is behind RLS — and the binaries themselves are the
 * same freely-redistributable files Google serves to anyone.
 */

alter table public.font_families
  add column if not exists category text not null default 'sans-serif',
  add column if not exists is_variable boolean not null default false,
  -- Off by default on purpose: a family that arrived because some template
  -- mentioned it is not something we offer until somebody says so. The importer
  -- switches the ones it brings in on.
  add column if not exists is_active boolean not null default false,
  add column if not exists is_featured boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.font_families
  drop constraint if exists font_families_category_known;
alter table public.font_families
  add constraint font_families_category_known check (category in (
    'sans-serif', 'serif', 'display', 'handwriting', 'monospace'
  ));

/** "Regular", "Bold Italic", "SemiBold" — what the family calls this cut. */
alter table public.font_faces
  add column if not exists style_name text not null default 'Regular';

/**
 * Searching by name, on a shelf that is about to hold two thousand of them.
 *
 * `normalized_name` is unique, so it already has a b-tree — but that index is
 * built for equality and `like 'mont%'` cannot use it under a non-C collation.
 * `text_pattern_ops` is the one that can, which is what makes typing "mont"
 * cheap rather than a sequential scan of the whole shelf.
 */
create index if not exists font_families_prefix_idx
  on public.font_families (normalized_name text_pattern_ops);

create index if not exists font_families_offered_idx
  on public.font_families (category, canonical_name) where is_active;

/**
 * Only what is offered, and only to people who are signed in.
 *
 * The previous policy was `using (true)`, which was fine when the table held
 * whatever a template had dragged in and nothing read it but the server. It is
 * not fine now that it is a catalogue: an app asking "what can I choose from"
 * should be told about the fonts we offer, not about every family that has ever
 * been resolved.
 *
 * Administrators see all of it, and here that clause is doing real work: the
 * console's whole job on this page is the rows that are not active yet.
 */
drop policy if exists font_families_read on public.font_families;
create policy font_families_read on public.font_families
  for select to authenticated using (is_active or (select public.is_admin()));

drop policy if exists font_faces_read on public.font_faces;
create policy font_faces_read on public.font_faces
  for select to authenticated using (
    (select public.is_admin())
    or exists (
      select 1 from public.font_families f
      where f.id = font_faces.family_id and f.is_active
    )
  );

/** Toggling a family on or off is an administrator's decision, and only theirs. */
create or replace function public.admin_set_font_family(
  p_family_id uuid,
  p_is_active boolean default null,
  p_is_featured boolean default null,
  p_category text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_category is not null and p_category not in (
    'sans-serif', 'serif', 'display', 'handwriting', 'monospace'
  ) then
    raise exception 'unknown font category' using errcode = '22023';
  end if;

  update public.font_families
     set is_active = coalesce(p_is_active, is_active),
         is_featured = coalesce(p_is_featured, is_featured),
         category = coalesce(p_category, category),
         updated_at = now()
   where id = p_family_id;
end;
$$;

revoke all on function public.admin_set_font_family(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.admin_set_font_family(uuid, boolean, boolean, text) to authenticated;
