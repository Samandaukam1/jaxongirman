-- "Kutubxonaga qo‘shish": a deck, game or scientific work shared in a chat,
-- copied into the receiver's own library (Jaxongirman.app 2.0, §5.4).
--
-- The copy is the receiver's to present, edit and keep; a deck comes with its
-- defence script, its sources and its pictures. It is made here in one
-- transaction — rows copied whole through jsonb, so a column added later is
-- copied too — and every stored file is renamed into the receiver's folder;
-- the files themselves are copied by the `chat-library` function from the
-- list this returns. A copied game is never sent to the store on the
-- receiver's behalf. Asking twice for the same message gives the same copy.

create table if not exists public.chat_library_copies (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.chat_library_copies enable row level security;
revoke all on public.chat_library_copies from anon, authenticated;

-- A copy is not a new game: it does not go to the store by itself.
create or replace function public.game_store_autopublish_arm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.game_store_autopublish_enabled()
     or new.kind = 'crossword' or current_setting('jaxongirman.copying', true) = 'on' then
    new.store_autopublish := 'off';
    new.store_autopublish_at := null;
    return new;
  end if;
  new.store_autopublish := 'pending';
  new.store_autopublish_at := now() + interval '1 hour';
  return new;
end;
$$;

/** A stored path moved from the sender's folder for the thing into the receiver's. */
create or replace function public.chat_library_path(p_path text, p_from text, p_to text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_path like p_from || '%' then p_to || substr(p_path, char_length(p_from) + 1) else p_path end;
$$;

create or replace function public.chat_library_copy(p_message_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.chat_messages%rowtype;
  v_kind text;
  v_source uuid;
  v_owner uuid;
  v_new uuid := gen_random_uuid();
  v_from text;
  v_to text;
  v_files jsonb := '[]'::jsonb;
  v_slides jsonb;
  v_existing uuid;
  v_now timestamptz := now();
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found or v_message.kind <> 'share' or v_message.share is null
     or not exists (select 1 from public.chat_members m where m.conversation_id = v_message.conversation_id and m.user_id = p_user) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  v_kind := v_message.share ->> 'kind';
  v_source := (v_message.share ->> 'id')::uuid;
  v_owner := v_message.sender_id;
  if v_owner = p_user then
    return jsonb_build_object('kind', v_kind, 'id', v_source, 'files', '[]'::jsonb);
  end if;

  select c.item_id into v_existing from public.chat_library_copies c where c.message_id = p_message_id and c.user_id = p_user;
  if v_existing is not null and (
    (v_kind = 'presentation' and exists (select 1 from public.presentations where id = v_existing))
    or (v_kind = 'game' and exists (select 1 from public.games where id = v_existing))
    or (v_kind = 'academic' and exists (select 1 from public.academic_works where id = v_existing))
  ) then
    return jsonb_build_object('kind', v_kind, 'id', v_existing, 'files', '[]'::jsonb);
  end if;

  v_from := v_owner::text || '/' || v_source::text || '/';
  v_to := p_user::text || '/' || v_new::text || '/';

  if v_kind = 'game' then
    perform set_config('jaxongirman.copying', 'on', true);
    insert into public.games
      select * from jsonb_populate_record(null::public.games, (
        select to_jsonb(g) || jsonb_build_object(
          'id', v_new, 'owner_id', p_user, 'cover_path', null, 'is_free', false, 'featured_at', null,
          'question_count', 0, 'sessions_count', 0, 'store_autopublish', 'off', 'store_autopublish_at', null,
          'source_presentation_id', null, 'created_at', v_now, 'updated_at', v_now)
          from public.games g where g.id = v_source and g.owner_id = v_owner));
    if not exists (select 1 from public.games where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;
    perform set_config('jaxongirman.copying', 'off', true);
    insert into public.game_questions
      select (jsonb_populate_record(null::public.game_questions, to_jsonb(q) || jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_new, 'owner_id', p_user,
        'media_path', public.chat_library_path(q.media_path, v_from, v_to), 'created_at', v_now, 'updated_at', v_now))).*
        from public.game_questions q where q.game_id = v_source order by q.position;
    select coalesce(jsonb_agg(jsonb_build_object('bucket', 'game-assets', 'from', q.media_path,
             'to', public.chat_library_path(q.media_path, v_from, v_to))), '[]'::jsonb)
      into v_files from public.game_questions q where q.game_id = v_source and q.media_path like v_from || '%';

  elsif v_kind = 'academic' then
    insert into public.academic_works
      select * from jsonb_populate_record(null::public.academic_works, (
        select to_jsonb(w) || jsonb_build_object('id', v_new, 'owner_id', p_user, 'spent_credits', 0, 'estimated_credits', 0,
          'created_at', v_now, 'updated_at', v_now)
          from public.academic_works w where w.id = v_source and w.owner_id = v_owner));
    if not exists (select 1 from public.academic_works where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;
    insert into public.academic_sections
      select (jsonb_populate_record(null::public.academic_sections, to_jsonb(s) || jsonb_build_object(
        'id', gen_random_uuid(), 'work_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.academic_sections s where s.work_id = v_source;

  elsif v_kind = 'presentation' then
    insert into public.presentations
      select * from jsonb_populate_record(null::public.presentations, (
        select to_jsonb(p) || jsonb_build_object(
          'id', v_new, 'owner_id', p_user, 'thumbnail_path', null,
          'estimated_credits', 0, 'reserved_credits', 0, 'actual_credits', 0, 'generation_cost_usd', 0,
          'created_at', v_now, 'updated_at', v_now)
          from public.presentations p where p.id = v_source and p.owner_id = v_owner and p.status = 'ready'));
    if not exists (select 1 from public.presentations where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;

    select coalesce(jsonb_object_agg(s.id::text, gen_random_uuid()), '{}'::jsonb) into v_slides
      from public.slides s where s.presentation_id = v_source;
    insert into public.slides
      select (jsonb_populate_record(null::public.slides, to_jsonb(s) || jsonb_build_object(
        'id', v_slides ->> s.id::text, 'presentation_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.slides s where s.presentation_id = v_source;
    insert into public.slide_elements
      select (jsonb_populate_record(null::public.slide_elements, to_jsonb(e) || jsonb_build_object(
        'id', gen_random_uuid(), 'slide_id', v_slides ->> e.slide_id::text, 'presentation_id', v_new, 'owner_id', p_user,
        'content', case when jsonb_typeof(e.content) = 'object' and (e.content ->> 'storagePath') like v_from || '%'
                        then e.content || jsonb_build_object('storagePath', public.chat_library_path(e.content ->> 'storagePath', v_from, v_to))
                        else e.content end,
        'created_at', v_now, 'updated_at', v_now))).*
        from public.slide_elements e where e.presentation_id = v_source;

    insert into public.presentation_assets
      select (jsonb_populate_record(null::public.presentation_assets, to_jsonb(a) || jsonb_build_object(
        'id', gen_random_uuid(), 'presentation_id', v_new, 'owner_id', p_user,
        'storage_path', public.chat_library_path(a.storage_path, v_from, v_to), 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_assets a where a.presentation_id = v_source;
    insert into public.presentation_sources
      select (jsonb_populate_record(null::public.presentation_sources, to_jsonb(s) || jsonb_build_object(
        'id', gen_random_uuid(), 'presentation_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_sources s where s.presentation_id = v_source;
    -- The defence script goes with the deck; its PDF is drawn again for the new owner.
    insert into public.presentation_defenses
      select (jsonb_populate_record(null::public.presentation_defenses, to_jsonb(d) || jsonb_build_object(
        'presentation_id', v_new, 'owner_id', p_user, 'pdf_path', null, 'pdf_rendered_at', null, 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_defenses d where d.presentation_id = v_source;

    select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', f.bucket, 'from', f.path, 'to', public.chat_library_path(f.path, v_from, v_to))), '[]'::jsonb)
      into v_files
      from (
        select e.content ->> 'storageBucket' as bucket, e.content ->> 'storagePath' as path
          from public.slide_elements e
         where e.presentation_id = v_source and jsonb_typeof(e.content) = 'object' and (e.content ->> 'storagePath') like v_from || '%'
        union
        select a.storage_bucket, a.storage_path from public.presentation_assets a
         where a.presentation_id = v_source and a.storage_path like v_from || '%'
      ) f
     where f.bucket in ('user-uploads', 'presentation-assets', 'generated-images', 'stock-images');
  else
    raise exception 'unknown share' using errcode = '22023';
  end if;

  insert into public.chat_library_copies (message_id, user_id, kind, item_id) values (p_message_id, p_user, v_kind, v_new)
    on conflict (message_id, user_id) do update set item_id = excluded.item_id, created_at = now();
  return jsonb_build_object('kind', v_kind, 'id', v_new, 'files', v_files);
end;
$$;
revoke all on function public.chat_library_copy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_library_copy(uuid, uuid) to service_role;
