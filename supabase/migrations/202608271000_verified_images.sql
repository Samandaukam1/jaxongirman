/**
 * Pictures somebody has confirmed are of the right thing.
 *
 * The generator can prove a person's identity through Wikidata, and for the
 * people an encyclopaedia has never heard of it correctly refuses to guess. But
 * a refusal is permanent: every deck about the same local figure searches
 * again, fails again, and shows an empty frame again, and nobody can teach the
 * system the answer.
 *
 * This is where the answer goes. An administrator confirms once that a
 * particular file is Yulduz Usmonova, and from then on every deck about her
 * takes that file without asking anybody — no search, no ranking, no cost, and
 * no chance of a different face.
 *
 * Additive: a new table, its policies and one index. Nothing existing changes.
 */

create table if not exists public.verified_images (
  id uuid primary key default gen_random_uuid(),

  /**
   * The lookup key: lowercased, apostrophes folded away.
   *
   * `Qudratxo‘ja`, `Qudratxo'ja` and `Qudratxoʻja` are one surname typed on
   * three keyboards, and a cache that treats them as three entries answers two
   * of them with a search that has already failed.
   */
  normalized_entity text not null,
  display_name text not null,
  /** Matches the resolver's own vocabulary: exact_person, specific_place, … */
  entity_type text not null default 'exact_person',

  /** Where the bytes live in `stock-images`, the bucket the generator uses. */
  image_storage_path text not null,
  /** The file as the provider serves it, so the choice stays checkable. */
  original_url text,
  /** The page a reader can be sent to — a Commons file page, an article. */
  source_url text,
  provider text not null,

  creator text,
  license text,
  license_url text,

  /** 0–1. What the resolver believed before a person confirmed it. */
  confidence numeric not null default 0,
  /**
   * False for something the resolver cached on its own reasoning, true once a
   * person has looked at it. Only a confirmed row skips the search entirely.
   */
  verified boolean not null default false,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** When the file was last known to still be there. */
  last_checked_at timestamptz,

  /**
   * One answer per thing per kind.
   *
   * Not per name alone: "Alisher Navoiy" is a poet and a university, and both
   * deserve a picture. The kind is what tells them apart.
   */
  unique (normalized_entity, entity_type)
);

comment on table public.verified_images is
  'Confirmed pictures of named things, so the resolver answers from memory instead of searching.';

create index if not exists verified_images_lookup_idx
  on public.verified_images (normalized_entity, entity_type) where verified;

alter table public.verified_images enable row level security;

/**
 * Everyone signed in may read a confirmed row; nobody may write one from a
 * browser.
 *
 * A picture asserted to be a named person is exactly the thing that must not be
 * settable by whoever asks. Writes happen through the service role, which is
 * the resolver and the admin console's server side.
 */
drop policy if exists verified_images_read on public.verified_images;
create policy verified_images_read on public.verified_images
  for select to authenticated using (verified or (select public.is_admin()));

revoke all on public.verified_images from anon, authenticated;
grant select on public.verified_images to authenticated;

/**
 * Confirming a picture, as one statement.
 *
 * A function rather than a table grant so the check lives beside the write:
 * only an administrator may confirm, and confirming the same thing twice
 * updates the row rather than failing or duplicating it.
 */
create or replace function public.verify_image(
  p_normalized_entity text,
  p_display_name text,
  p_entity_type text,
  p_storage_path text,
  p_provider text,
  p_original_url text default null,
  p_source_url text default null,
  p_creator text default null,
  p_license text default null,
  p_license_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.verified_images (
    normalized_entity, display_name, entity_type, image_storage_path, provider,
    original_url, source_url, creator, license, license_url, metadata,
    confidence, verified, verified_by, verified_at, last_checked_at
  ) values (
    btrim(lower(p_normalized_entity)), p_display_name, p_entity_type, p_storage_path, p_provider,
    p_original_url, p_source_url, p_creator, p_license, p_license_url, coalesce(p_metadata, '{}'::jsonb),
    1, true, auth.uid(), now(), now()
  )
  on conflict (normalized_entity, entity_type) do update set
    display_name = excluded.display_name,
    image_storage_path = excluded.image_storage_path,
    provider = excluded.provider,
    original_url = excluded.original_url,
    source_url = excluded.source_url,
    creator = excluded.creator,
    license = excluded.license,
    license_url = excluded.license_url,
    metadata = excluded.metadata,
    confidence = 1,
    verified = true,
    verified_by = auth.uid(),
    verified_at = now(),
    last_checked_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.verify_image is
  'Admin-only. Records that a stored picture really is of the named thing.';

revoke all on function public.verify_image(text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.verify_image(text, text, text, text, text, text, text, text, text, text, jsonb) to authenticated;
