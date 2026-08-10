-- Importing a PowerPoint file into the editor.
--
-- The deck a user brings in becomes an ordinary presentation: the same tables,
-- the same editor, the same export. Nothing here is import-specific once the
-- rows exist, which is the point — an imported deck should be indistinguishable
-- from a generated one the moment it lands.
--
-- Credits are not involved. Reading a file the user already has costs no model
-- tokens, so `start_generation`'s reservation machinery is deliberately not on
-- this path; the only thing that needs guarding is that a caller can create and
-- finish their own import and nobody else's.

-- The bucket already takes PDFs and Word files; PowerPoint was the omission
-- that made this feature impossible to upload for.
update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'image/jpeg', 'image/png', 'image/webp'
  ]
  where id = 'user-uploads';

/**
 * Opens an empty presentation for an import to fill.
 *
 * Called by the user, so the row is theirs by construction — the edge function
 * that writes the slides runs as the service role and could otherwise be talked
 * into filling somebody else's deck.
 */
create or replace function public.pptx_import_start(
  p_title text,
  p_source_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_title text;
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then v_title := 'Import qilingan taqdimot'; end if;
  v_title := left(v_title, 180);

  insert into public.presentations (owner_id, title, topic, style, status, requested_slide_count)
  values (
    v_user,
    v_title,
    -- `topic` has a three character floor and is what the rest of the app shows
    -- as provenance, so the file name is prefixed rather than used bare.
    left('PowerPoint fayldan import: ' || coalesce(nullif(btrim(coalesce(p_source_name, '')), ''), 'nomsiz.pptx'), 2000),
    'simple'::public.presentation_style,
    'generating'::public.presentation_status,
    1
  )
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Marks an import finished once its slides are in place.
 *
 * Service role only: it is called after the edge function has written the rows,
 * and the slide count it records has to be the number actually written rather
 * than a number a client claims.
 */
create or replace function public.pptx_import_finish(
  p_presentation_id uuid,
  p_slide_count integer
)
returns public.presentations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.presentations%rowtype;
begin
  if p_slide_count < 1 or p_slide_count > 30 then
    raise exception 'slide count out of range' using errcode = '22023';
  end if;

  update public.presentations set
    status = 'ready'::public.presentation_status,
    requested_slide_count = p_slide_count,
    generated_slide_count = p_slide_count,
    error_message = null,
    updated_at = now()
    where id = p_presentation_id
      and status = 'generating'::public.presentation_status
    returning * into v_row;
  if not found then raise exception 'import not found or already settled' using errcode = 'P0002'; end if;

  return v_row;
end;
$$;

/** Records why an import produced nothing. Service role only. */
create or replace function public.pptx_import_fail(
  p_presentation_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.presentations set
    status = 'failed'::public.presentation_status,
    error_message = left(coalesce(p_message, 'Import amalga oshmadi.'), 1800),
    updated_at = now()
    where id = p_presentation_id
      and status = 'generating'::public.presentation_status;
end;
$$;

-- ----------------------------------------------------------------- grants --
do $$
begin
  execute 'revoke all on function public.pptx_import_start(text, text) from public, anon';
  execute 'grant execute on function public.pptx_import_start(text, text) to authenticated, service_role';

  -- Settling an import is the service role's job; a client that could call
  -- these could mark a deck ready that has no slides in it.
  execute 'revoke all on function public.pptx_import_finish(uuid, integer) from public, anon, authenticated';
  execute 'revoke all on function public.pptx_import_fail(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.pptx_import_finish(uuid, integer) to service_role';
  execute 'grant execute on function public.pptx_import_fail(uuid, text) to service_role';
end
$$;
