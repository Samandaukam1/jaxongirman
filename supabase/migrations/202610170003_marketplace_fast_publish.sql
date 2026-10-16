/**
 * Selling a deck made here, in a few taps — and approving it without a person
 * only when the server can prove it is what the generator made.
 *
 * Proof is a revision trail the client cannot write. Every change to a deck's
 * slides or elements, or to its title, is recorded by a trigger with who made
 * it — the generator (`ai_generation`), the system afterwards
 * (`system_repair`), the owner (`user_edit`), an administrator
 * (`admin_modification`) or an import (`external_import`) — whatever path the
 * change took: the editor's RPC, a direct table write, an export, a rename.
 * A deck counts as untouched only if its trail began when it was created and
 * holds no owner or admin change. Decks made before this trail existed cannot
 * be proven untouched and go to review.
 *
 * Auto-approval is rules only — no model reads anything: made here by the
 * generator, untouched, no uploaded source files, no blocked words in its
 * title, description or slides, a seller in good standing, valid price and
 * title. Anything else is listed for review. Publishing is idempotent: one
 * live listing per deck.
 */

/* ------------------------------------------------------- revision trail */

create table public.presentation_revision_state (
  presentation_id uuid primary key references public.presentations(id) on delete cascade,
  tracked_since timestamptz not null default now(),
  user_edits integer not null default 0,
  admin_edits integer not null default 0,
  system_edits integer not null default 0,
  imported boolean not null default false,
  last_user_edit_at timestamptz,
  last_admin_edit_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.presentation_revision_audit (
  id bigserial primary key,
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('ai_generation', 'system_repair', 'user_edit', 'external_import', 'admin_modification')),
  source text not null,
  -- One row per kind of change per minute: the trail records that a deck was
  -- edited and by whom, not every keystroke.
  minute_bucket timestamptz not null,
  created_at timestamptz not null default now(),
  unique (presentation_id, actor_kind, minute_bucket)
);

create index presentation_revision_audit_presentation on public.presentation_revision_audit(presentation_id, created_at);

alter table public.presentation_revision_state enable row level security;
alter table public.presentation_revision_audit enable row level security;
create policy presentation_revision_state_read on public.presentation_revision_state for select to authenticated
  using (public.is_admin(auth.uid()) or exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()));
create policy presentation_revision_audit_read on public.presentation_revision_audit for select to authenticated
  using (public.is_admin(auth.uid()) or exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()));
grant select on public.presentation_revision_state, public.presentation_revision_audit to authenticated;
grant all on public.presentation_revision_state, public.presentation_revision_audit to service_role;
grant usage on sequence public.presentation_revision_audit_id_seq to service_role;

/** Who is changing this deck, from the server's own view of the caller. */
create or replace function public.presentation_actor_kind(p_presentation_id uuid, p_owner uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if coalesce(auth.role(), '') = 'service_role' or v_actor is null then
    if not exists (select 1 from public.generation_jobs where presentation_id = p_presentation_id) then
      return 'external_import';
    end if;
    if exists (select 1 from public.generation_jobs where presentation_id = p_presentation_id and status in ('queued', 'running')) then
      return 'ai_generation';
    end if;
    return 'system_repair';
  end if;
  if v_actor <> p_owner and public.is_admin(v_actor) then
    return 'admin_modification';
  end if;
  return 'user_edit';
end;
$$;

create or replace function public.presentation_record_revision(p_presentation_id uuid, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_kind text;
begin
  select owner_id into v_owner from public.presentations where id = p_presentation_id;
  if v_owner is null then return; end if;  -- the deck itself is being deleted
  v_kind := public.presentation_actor_kind(p_presentation_id, v_owner);

  insert into public.presentation_revision_audit (presentation_id, actor_id, actor_kind, source, minute_bucket)
  values (p_presentation_id, auth.uid(), v_kind, p_source, date_trunc('minute', now()))
  on conflict (presentation_id, actor_kind, minute_bucket) do nothing;

  insert into public.presentation_revision_state (presentation_id, tracked_since, user_edits, admin_edits, system_edits, imported,
                                                  last_user_edit_at, last_admin_edit_at)
  values (p_presentation_id, now(),
          (v_kind = 'user_edit')::int, (v_kind = 'admin_modification')::int,
          (v_kind in ('ai_generation', 'system_repair'))::int, v_kind = 'external_import',
          case when v_kind = 'user_edit' then now() end, case when v_kind = 'admin_modification' then now() end)
  on conflict (presentation_id) do update set
    user_edits = public.presentation_revision_state.user_edits + (v_kind = 'user_edit')::int,
    admin_edits = public.presentation_revision_state.admin_edits + (v_kind = 'admin_modification')::int,
    system_edits = public.presentation_revision_state.system_edits + (v_kind in ('ai_generation', 'system_repair'))::int,
    imported = public.presentation_revision_state.imported or v_kind = 'external_import',
    last_user_edit_at = case when v_kind = 'user_edit' then now() else public.presentation_revision_state.last_user_edit_at end,
    last_admin_edit_at = case when v_kind = 'admin_modification' then now() else public.presentation_revision_state.last_admin_edit_at end,
    updated_at = now();
end;
$$;

revoke all on function public.presentation_actor_kind(uuid, uuid) from public, anon, authenticated;
revoke all on function public.presentation_record_revision(uuid, text) from public, anon, authenticated;

create or replace function public.presentation_track_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.presentation_record_revision(
    case when tg_op = 'DELETE' then old.presentation_id else new.presentation_id end,
    tg_table_name || ':' || lower(tg_op));
  return null;
end;
$$;

create or replace function public.presentation_track_birth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- The trail begins with the deck; a deck without this row predates it.
    insert into public.presentation_revision_state (presentation_id) values (new.id) on conflict do nothing;
  else
    perform public.presentation_record_revision(new.id, 'presentations:rename');
  end if;
  return null;
end;
$$;

revoke all on function public.presentation_track_content() from public, anon, authenticated;
revoke all on function public.presentation_track_birth() from public, anon, authenticated;

create trigger slide_elements_revision
  after insert or delete or update of slide_id, type, x, y, width, height, rotation, z_index, opacity, locked, style, content
  on public.slide_elements for each row execute function public.presentation_track_content();
create trigger slides_revision
  after insert or delete or update of position, title, layout, background, speaker_notes
  on public.slides for each row execute function public.presentation_track_content();
create trigger presentations_revision_birth
  after insert on public.presentations for each row execute function public.presentation_track_birth();
create trigger presentations_revision_rename
  after update of title on public.presentations for each row
  when (old.title is distinct from new.title)
  execute function public.presentation_track_birth();

/* ---------------------------------------------------- listing columns */

alter table public.marketplace_products
  add column if not exists source_presentation_id uuid references public.presentations(id) on delete set null,
  add column if not exists approval_source text,
  add column if not exists revision_snapshot jsonb,
  add column if not exists suspended_at timestamptz,
  add column if not exists moderation_note text;

alter table public.marketplace_products
  add constraint marketplace_products_approval_source check (approval_source is null or approval_source in ('auto', 'manual'));

-- One live listing per deck: a second publish of the same deck is the first one.
create unique index marketplace_products_one_per_presentation
  on public.marketplace_products(source_presentation_id)
  where source_presentation_id is not null and status <> 'archived'::public.marketplace_product_status;

/**
 * The provenance columns are the server's. A seller may edit their own
 * listing (and its RLS lets them), but not where it came from, how it was
 * approved, or whether it was suspended; and a listing may only point at the
 * seller's own deck, so nobody can occupy someone else's deck's one listing.
 */
create or replace function public.marketplace_guard_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null or public.is_admin(auth.uid())
     or current_setting('jaxongirman.trusted_write', true) = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.source_presentation_id := old.source_presentation_id;
    new.approval_source := old.approval_source;
    new.revision_snapshot := old.revision_snapshot;
    new.suspended_at := old.suspended_at;
    new.moderation_note := old.moderation_note;
  else
    new.approval_source := null;
    new.revision_snapshot := null;
    new.suspended_at := null;
    new.moderation_note := null;
    if new.source_presentation_id is not null and not exists (
      select 1 from public.presentations where id = new.source_presentation_id and owner_id = new.seller_id) then
      raise exception 'a listing may only point at the seller''s own deck' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger marketplace_products_guard_provenance
  before insert or update on public.marketplace_products
  for each row execute function public.marketplace_guard_provenance();

/**
 * Approval covers the files that were approved. A seller who adds, swaps or
 * removes a file of a live listing sends it back to review — the same rule the
 * listing's own words already follow.
 */
create or replace function public.marketplace_files_reopen_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null or public.is_admin(auth.uid()) then
    return null;
  end if;
  -- A write of the server's own, so the provenance guard lets it through.
  perform set_config('jaxongirman.trusted_write', 'on', true);
  update public.marketplace_products
     set status = 'pending_review', approval_source = 'manual', moderation_note = 'Fayllar o‘zgartirildi'
   where id = coalesce(new.product_id, old.product_id) and status = 'approved';
  perform set_config('jaxongirman.trusted_write', 'off', true);
  return null;
end;
$$;

create trigger marketplace_product_files_reopen_review
  after insert or update or delete on public.marketplace_product_files
  for each row execute function public.marketplace_files_reopen_review();

revoke all on function public.marketplace_guard_provenance() from public, anon, authenticated;
revoke all on function public.marketplace_files_reopen_review() from public, anon, authenticated;

create table public.marketplace_auto_approval_events (
  id bigserial primary key,
  product_id uuid references public.marketplace_products(id) on delete set null,
  presentation_id uuid references public.presentations(id) on delete set null,
  seller_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('auto_approved', 'pending_review', 'refused')),
  reasons jsonb not null default '[]'::jsonb,
  revision jsonb,
  created_at timestamptz not null default now()
);

create index marketplace_auto_approval_events_created on public.marketplace_auto_approval_events(created_at desc);

alter table public.marketplace_auto_approval_events enable row level security;
create policy marketplace_auto_approval_events_read on public.marketplace_auto_approval_events for select to authenticated
  using (seller_id = auth.uid() or public.is_admin(auth.uid()));
grant select on public.marketplace_auto_approval_events to authenticated;
grant all on public.marketplace_auto_approval_events to service_role;
grant usage on sequence public.marketplace_auto_approval_events_id_seq to service_role;

insert into public.app_settings (key, value, description)
values (
  'marketplace.fast_publish',
  jsonb_build_object(
    'enabled', true,
    'auto_approve', true,
    'min_price', 1000,
    'max_price', 500000,
    -- Plain words; matched case-insensitively anywhere in the title,
    -- description or the deck's text. The operator extends the list.
    'blocked_terms', jsonb_build_array(
      'porno', 'порно', 'porn', 'narkotik', 'наркотик', 'drugs', 'qurol sotiladi', 'terror', 'террор',
      'kazino', 'казино', 'casino', 'stavka', 'ставки', 'betting', 'hack', 'взлом', 'kredit karta raqami')
  ),
  'Marketplace fast publishing: auto-approval switch, price bounds and words that send a listing to review.'
)
on conflict (key) do nothing;

/* --------------------------------------------------------- eligibility */

/**
 * Whether a deck may be sold, and whether it may go live without review.
 *
 * `blocking` reasons stop publishing altogether; `review` reasons send the
 * listing to a moderator; none means it is approved automatically.
 */
create or replace function public.marketplace_fast_publish_check(p_presentation_id uuid, p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_presentation public.presentations%rowtype;
  v_state public.presentation_revision_state%rowtype;
  v_settings jsonb := coalesce((select value from public.app_settings where key = 'marketplace.fast_publish'), '{}'::jsonb);
  v_blocking jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_term text;
  v_text text;
  v_existing public.marketplace_products%rowtype;
  v_pages integer;
begin
  if p_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_reads_own_entitlements(p_user_id);

  select * into v_presentation from public.presentations where id = p_presentation_id;
  if not found or v_presentation.owner_id <> p_user_id then
    return jsonb_build_object('can_publish', false, 'auto', false,
      'blocking', jsonb_build_array(jsonb_build_object('code', 'not_owner', 'message', 'Taqdimot topilmadi.')), 'review', '[]'::jsonb);
  end if;

  if not coalesce((v_settings ->> 'enabled')::boolean, true) then
    v_blocking := v_blocking || jsonb_build_object('code', 'disabled', 'message', 'Tez sotuv vaqtincha o‘chirilgan.');
  end if;
  if v_presentation.status <> 'ready' then
    v_blocking := v_blocking || jsonb_build_object('code', 'not_ready', 'message', 'Taqdimot hali tayyor emas.');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and status = 'blocked') then
    v_blocking := v_blocking || jsonb_build_object('code', 'seller_blocked', 'message', 'Hisobingiz cheklangan.');
  end if;

  select * into v_existing from public.marketplace_products
   where source_presentation_id = p_presentation_id and status <> 'archived'
   order by created_at desc limit 1;
  if v_existing.id is not null and v_existing.status in ('approved', 'pending_review') then
    v_blocking := v_blocking || jsonb_build_object('code', 'already_listed', 'message', 'Bu taqdimot allaqachon sotuvda yoki tekshiruvda.',
                                                   'product_id', v_existing.id, 'status', v_existing.status);
  end if;

  -- Made here by the generator.
  if not exists (select 1 from public.generation_jobs where presentation_id = p_presentation_id and status = 'succeeded') then
    v_review := v_review || jsonb_build_object('code', 'not_generated_in_app', 'message', 'Taqdimot ilovada AI bilan yaratilmagan (import yoki nusxa).');
  end if;

  -- Untouched, by the server's own trail.
  select * into v_state from public.presentation_revision_state where presentation_id = p_presentation_id;
  if v_state.presentation_id is null then
    v_review := v_review || jsonb_build_object('code', 'untracked', 'message', 'Taqdimot tahrir tarixi yuritilishidan oldin yaratilgan.');
  else
    if v_state.imported then
      v_review := v_review || jsonb_build_object('code', 'imported', 'message', 'Tashqi PPTX fayldan import qilingan.');
    end if;
    if v_state.user_edits > 0 then
      v_review := v_review || jsonb_build_object('code', 'manually_edited', 'message', 'Taqdimot qo‘lda tahrirlangan.', 'last', v_state.last_user_edit_at);
    end if;
    if v_state.admin_edits > 0 then
      v_review := v_review || jsonb_build_object('code', 'admin_modified', 'message', 'Taqdimotni administrator o‘zgartirgan.');
    end if;
  end if;

  -- Source files the generator was given.
  if exists (select 1 from public.presentation_assets where presentation_id = p_presentation_id and kind = 'upload') then
    v_review := v_review || jsonb_build_object('code', 'external_files', 'message', 'Yaratishda tashqi fayllar biriktirilgan.');
  end if;

  -- Words that need a person to look.
  select lower(coalesce(v_presentation.title, '') || ' ' || coalesce(v_presentation.topic, '') || ' ' ||
         coalesce(string_agg(e.content ->> 'text', ' '), ''))
    into v_text
    from public.slide_elements e where e.presentation_id = p_presentation_id and e.type = 'text';
  for v_term in select jsonb_array_elements_text(coalesce(v_settings -> 'blocked_terms', '[]'::jsonb)) loop
    if v_term <> '' and position(lower(v_term) in v_text) > 0 then
      v_review := v_review || jsonb_build_object('code', 'policy_terms', 'message', 'Matnda tekshiruv talab qiladigan so‘z bor.', 'term', v_term);
      exit;
    end if;
  end loop;

  -- A seller whose listing was suspended lately sells under review.
  if exists (select 1 from public.marketplace_products where seller_id = p_user_id and suspended_at > now() - interval '30 days') then
    v_review := v_review || jsonb_build_object('code', 'seller_restricted', 'message', 'Yaqinda mahsulotingiz to‘xtatilgan.');
  end if;
  if not coalesce((v_settings ->> 'auto_approve')::boolean, true) then
    v_review := v_review || jsonb_build_object('code', 'auto_off', 'message', 'Avtomatik tasdiqlash o‘chirilgan.');
  end if;

  select count(*) into v_pages from public.slides where presentation_id = p_presentation_id;

  return jsonb_build_object(
    'can_publish', jsonb_array_length(v_blocking) = 0,
    'auto', jsonb_array_length(v_blocking) = 0 and jsonb_array_length(v_review) = 0,
    'blocking', v_blocking,
    'review', v_review,
    'existing_product_id', v_existing.id,
    'defaults', jsonb_build_object(
      'title', left(btrim(v_presentation.title), 160),
      'pages', v_pages,
      'language', 'uz',
      'format', 'pptx',
      'description', left(format('%s. %s sahifalik taqdimot, Jaxongirman’da yaratilgan.', btrim(v_presentation.topic), v_pages), 600),
      'min_price', coalesce((v_settings ->> 'min_price')::integer, 1000),
      'max_price', coalesce((v_settings ->> 'max_price')::integer, 500000)),
    'revision', case when v_state.presentation_id is null then null else jsonb_build_object(
      'tracked_since', v_state.tracked_since, 'user_edits', v_state.user_edits, 'admin_edits', v_state.admin_edits,
      'system_edits', v_state.system_edits, 'imported', v_state.imported) end
  );
end;
$$;

/**
 * Opens (or reopens) the draft listing a fast publish fills: the deck's own
 * title, page count and format. Returns the draft and the check, so the app
 * can show what will happen before anything is uploaded.
 */
create or replace function public.marketplace_fast_draft(p_presentation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_check jsonb;
  v_product uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_marketplace_member('sell');
  v_check := public.marketplace_fast_publish_check(p_presentation_id, v_user);
  if not (v_check ->> 'can_publish')::boolean then
    return jsonb_build_object('product_id', v_check ->> 'existing_product_id', 'check', v_check);
  end if;

  select id into v_product from public.marketplace_products
   where source_presentation_id = p_presentation_id and seller_id = v_user and status in ('draft', 'rejected', 'hidden')
   order by created_at desc limit 1;
  if v_product is null then
    insert into public.marketplace_products (
      seller_id, material_type, title, description, status, base_price, content_units, file_format, source_presentation_id
    ) values (
      v_user, 'presentation', v_check -> 'defaults' ->> 'title', v_check -> 'defaults' ->> 'description', 'draft',
      0, nullif((v_check -> 'defaults' ->> 'pages')::integer, 0), 'pptx', p_presentation_id
    ) returning id into v_product;
  end if;
  return jsonb_build_object('product_id', v_product, 'check', v_check);
end;
$$;

/**
 * Puts the listing up, after the edge function has written its file.
 *
 * Service role only: it trusts nothing the app sends except the seller's
 * title, price and description, re-runs the check, and decides the status
 * here. Every decision is recorded with its reasons.
 */
create or replace function public.marketplace_fast_publish_finish(
  p_user_id uuid, p_product_id uuid, p_title text, p_price integer, p_description text,
  p_cover_path text, p_preview_paths text[], p_main_path text, p_main_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.marketplace_products%rowtype;
  v_check jsonb;
  v_settings jsonb := coalesce((select value from public.app_settings where key = 'marketplace.fast_publish'), '{}'::jsonb);
  v_auto boolean;
  v_status public.marketplace_product_status;
  v_path text;
  v_position integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_product from public.marketplace_products where id = p_product_id for update;
  if not found or v_product.seller_id <> p_user_id or v_product.source_presentation_id is null then
    raise exception 'listing not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception 'Sarlavha 3–160 belgi bo‘lsin.' using errcode = '22023';
  end if;
  if p_price is null or p_price < coalesce((v_settings ->> 'min_price')::integer, 1000)
     or p_price > coalesce((v_settings ->> 'max_price')::integer, 500000) then
    raise exception 'Narx % – % so‘m oralig‘ida bo‘lsin.', coalesce((v_settings ->> 'min_price')::integer, 1000), coalesce((v_settings ->> 'max_price')::integer, 500000)
      using errcode = '22023';
  end if;

  v_check := public.marketplace_fast_publish_check(v_product.source_presentation_id, p_user_id);
  if not (v_check ->> 'can_publish')::boolean then
    insert into public.marketplace_auto_approval_events (product_id, presentation_id, seller_id, decision, reasons, revision)
    values (p_product_id, v_product.source_presentation_id, p_user_id, 'refused', v_check -> 'blocking', v_check -> 'revision');
    raise exception '%', coalesce(v_check -> 'blocking' -> 0 ->> 'message', 'Sotuvga chiqarib bo‘lmaydi.') using errcode = 'P0001';
  end if;

  -- The listing's own words are checked too: a title can carry what the deck does not.
  for v_path in select jsonb_array_elements_text(coalesce(v_settings -> 'blocked_terms', '[]'::jsonb)) loop
    if v_path <> '' and position(lower(v_path) in lower(p_title || ' ' || coalesce(p_description, ''))) > 0 then
      v_check := jsonb_set(v_check, '{review}', (v_check -> 'review') || jsonb_build_object('code', 'policy_terms', 'message', 'Sarlavha yoki tavsifda tekshiruv talab qiladigan so‘z bor.', 'term', v_path));
      v_check := jsonb_set(v_check, '{auto}', 'false'::jsonb);
      exit;
    end if;
  end loop;

  v_auto := (v_check ->> 'auto')::boolean;
  v_status := case when v_auto then 'approved'::public.marketplace_product_status else 'pending_review'::public.marketplace_product_status end;

  delete from public.marketplace_product_files where product_id = p_product_id;
  insert into public.marketplace_product_files (product_id, kind, storage_path, mime_type, size_bytes, original_name, position)
  values (p_product_id, 'main', p_main_path, 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          greatest(coalesce(p_main_size, 1), 1), left(btrim(p_title), 150) || '.pptx', 0);
  foreach v_path in array coalesce(p_preview_paths, '{}'::text[]) loop
    v_position := v_position + 1;
    if v_position > 6 then exit; end if;
    if split_part(v_path, '/', 1) <> p_user_id::text or split_part(v_path, '/', 2) <> p_product_id::text then
      raise exception 'preview does not belong to this listing' using errcode = '42501';
    end if;
    insert into public.marketplace_product_files (product_id, kind, storage_path, mime_type, size_bytes, original_name, position)
    values (p_product_id, 'preview', v_path, 'image/jpeg', 1, 'preview-' || v_position || '.jpg', v_position);
  end loop;
  if p_cover_path is not null and (split_part(p_cover_path, '/', 1) <> p_user_id::text or split_part(p_cover_path, '/', 2) <> p_product_id::text) then
    raise exception 'cover does not belong to this listing' using errcode = '42501';
  end if;

  update public.marketplace_products set
    title = btrim(p_title),
    description = left(btrim(coalesce(p_description, '')), 4000),
    base_price = p_price,
    cover_path = coalesce(p_cover_path, cover_path),
    file_format = 'pptx',
    status = v_status,
    approval_source = case when v_auto then 'auto' else 'manual' end,
    published_at = case when v_auto then now() else published_at end,
    rejection_reason = null,
    moderated_by = null,
    moderated_at = case when v_auto then now() else null end,
    moderation_note = case when v_auto then 'Avtomatik tasdiqlandi' else null end,
    revision_snapshot = v_check -> 'revision',
    updated_at = now()
  where id = p_product_id;

  insert into public.marketplace_auto_approval_events (product_id, presentation_id, seller_id, decision, reasons, revision)
  values (p_product_id, v_product.source_presentation_id, p_user_id,
          case when v_auto then 'auto_approved' else 'pending_review' end, v_check -> 'review', v_check -> 'revision');

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    p_user_id,
    (case when v_auto then 'product_approved' else 'system' end)::public.notification_kind,
    case when v_auto then 'Taqdimot sotuvga chiqdi' else 'Taqdimot tekshiruvga yuborildi' end,
    case when v_auto then '“' || btrim(p_title) || '” endi Do‘konda ko‘rinadi.'
         else '“' || btrim(p_title) || '” moderator tekshiruvidan so‘ng Do‘konda ko‘rinadi.' end,
    jsonb_build_object('product_id', p_product_id, 'status', v_status, 'auto', v_auto),
    '/(app)/marketplace/seller', p_product_id
  );

  return jsonb_build_object('product_id', p_product_id, 'status', v_status, 'auto', v_auto, 'reasons', v_check -> 'review');
end;
$$;

revoke all on function public.marketplace_fast_publish_check(uuid, uuid) from public, anon;
revoke all on function public.marketplace_fast_draft(uuid) from public, anon;
revoke all on function public.marketplace_fast_publish_finish(uuid, uuid, text, integer, text, text, text[], text, integer) from public, anon, authenticated;
grant execute on function public.marketplace_fast_publish_check(uuid, uuid) to authenticated;
grant execute on function public.marketplace_fast_draft(uuid) to authenticated;
grant execute on function public.marketplace_fast_publish_finish(uuid, uuid, text, integer, text, text, text[], text, integer) to service_role;

/* ---------------------------------------------------------- moderation */

/**
 * Moderation, with two more actions: `suspend` takes a listing down for a
 * policy problem and restricts the seller's auto-approval for 30 days;
 * `request_changes` sends it back with what to fix. Everything is logged.
 */
create or replace function public.admin_moderate_product(
  p_product_id uuid,
  p_action text,
  p_reason text default ''
)
returns public.marketplace_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.marketplace_products%rowtype;
  v_after public.marketplace_products%rowtype;
  v_status public.marketplace_product_status;
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  v_status := case p_action
    when 'approve' then 'approved'::public.marketplace_product_status
    when 'reject' then 'rejected'::public.marketplace_product_status
    when 'request_changes' then 'rejected'::public.marketplace_product_status
    when 'hide' then 'hidden'::public.marketplace_product_status
    when 'unpublish' then 'hidden'::public.marketplace_product_status
    when 'suspend' then 'hidden'::public.marketplace_product_status
    when 'restore' then 'approved'::public.marketplace_product_status
    when 'archive' then 'archived'::public.marketplace_product_status
    else null
  end;
  if v_status is null then raise exception 'unknown moderation action %', p_action using errcode = '22023'; end if;
  if p_action in ('reject', 'request_changes', 'suspend') and v_reason = '' then
    raise exception 'this action needs a reason' using errcode = '22023';
  end if;

  select * into v_before from public.marketplace_products where id = p_product_id for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;

  update public.marketplace_products set
    status = v_status,
    published_at = case
      when v_status = 'approved'::public.marketplace_product_status then coalesce(v_before.published_at, now())
      else v_before.published_at end,
    rejection_reason = case when v_status = 'rejected'::public.marketplace_product_status
                            then case when p_action = 'request_changes' then 'O‘zgartirish kerak: ' || v_reason else v_reason end
                            else null end,
    approval_source = case when p_action in ('approve', 'restore') then 'manual' else approval_source end,
    suspended_at = case when p_action = 'suspend' then now() when p_action = 'restore' then null else suspended_at end,
    moderation_note = case when v_reason <> '' then v_reason else moderation_note end,
    moderated_by = v_admin,
    moderated_at = now()
    where id = p_product_id
    returning * into v_after;

  if v_status in ('approved'::public.marketplace_product_status, 'rejected'::public.marketplace_product_status)
     or p_action in ('suspend', 'unpublish') then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_before.seller_id,
      (case when v_status = 'approved'::public.marketplace_product_status then 'product_approved'
            when v_status = 'rejected'::public.marketplace_product_status then 'product_rejected'
            else 'system' end)::public.notification_kind,
      case when v_status = 'approved'::public.marketplace_product_status then 'Mahsulot tasdiqlandi'
           when p_action = 'request_changes' then 'Mahsulotga o‘zgartirish kerak'
           when p_action = 'suspend' then 'Mahsulot to‘xtatildi'
           when p_action = 'unpublish' then 'Mahsulot sotuvdan olindi'
           else 'Mahsulot qaytarildi' end,
      case when v_status = 'approved'::public.marketplace_product_status
        then '“' || v_before.title || '” endi Do‘konda ko‘rinadi.'
        else '“' || v_before.title || '”' || case when v_reason <> '' then '. Sabab: ' || v_reason else '' end end,
      jsonb_build_object('product_id', p_product_id, 'status', v_status, 'action', p_action),
      '/(app)/marketplace/seller', p_product_id
    );
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'marketplace.moderate', 'marketplace_product', p_product_id::text,
    jsonb_build_object('status', v_before.status, 'title', v_before.title),
    jsonb_build_object('status', v_after.status, 'action', p_action), v_reason
  );

  return v_after;
end;
$$;

/** A listing's provenance for the moderator: its deck's trail and every publish decision. */
create or replace function public.admin_listing_provenance(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.marketplace_products%rowtype;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin role required' using errcode = '42501'; end if;
  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'source_presentation_id', v_product.source_presentation_id,
    'approval_source', v_product.approval_source,
    'revision_snapshot', v_product.revision_snapshot,
    'state', (select to_jsonb(s) from public.presentation_revision_state s where s.presentation_id = v_product.source_presentation_id),
    'trail', coalesce((select jsonb_agg(jsonb_build_object('kind', a.actor_kind, 'source', a.source, 'at', a.created_at,
                                                           'actor', (select full_name from public.profiles where id = a.actor_id))
                                        order by a.created_at)
                         from public.presentation_revision_audit a where a.presentation_id = v_product.source_presentation_id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('decision', e.decision, 'reasons', e.reasons, 'at', e.created_at) order by e.created_at)
                             from public.marketplace_auto_approval_events e where e.product_id = p_product_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_listing_provenance(uuid) from public, anon;
grant execute on function public.admin_listing_provenance(uuid) to authenticated;
