/**
 * Sayt sahifalari: the legal pages the stores link to, edited in the console.
 *
 * App Store Connect and Google Play each hold a URL — /privacy, /support,
 * /delete-account — typed once into a form nobody revisits. So the pages behind
 * them must exist from the moment this migration lands, and must not disappear
 * while somebody is editing them. That second property is what shapes the
 * tables:
 *
 *   site_pages          what the site shows: one row per page, the live text.
 *                       Readable by anybody, but only once published.
 *   site_page_drafts    work in progress, at most one per page, admin-only.
 *                       Saving a draft never touches the live row, so a
 *                       half-written edit cannot take a store's URL down.
 *   site_page_versions  every published text in full. Reverting publishes an
 *                       old text again as a new version, so history only grows.
 *
 * Uzbek is the source of every page and lives in `title`/`body`; English and
 * Russian sit beside it in `*_i18n`, the shape the rest of the operator's
 * content already uses (202610180002). An empty translation means the site
 * shows the Uzbek.
 *
 * The operator's contact details — legal name, STIR, address, phone, email,
 * Telegram — are one setting, `site.contacts`, and the pages reach them through
 * `{{support_email}}` and friends, so an address changes in one place. The
 * setting ships empty: nothing in this repository knows them, and a line whose
 * value is empty is left off the page rather than shown with a placeholder.
 *
 * Every write is a security-definer RPC that checks `is_admin()` and appends to
 * `admin_audit_logs` in the same transaction. No client writes these tables.
 */

-- ------------------------------------------------------------- settings --

/**
 * `app_settings` could not be read signed out at all.
 *
 * Its one select policy is `public_read or (select is_admin())`, granted to
 * anon and authenticated alike — but anon holds no EXECUTE on `is_admin`, so
 * the initplan raises `permission denied for function is_admin` before
 * `public_read` is ever looked at. The legal pages are read signed out and need
 * two public settings, so the policy is split: anon sees exactly the rows
 * marked public and never reaches a function it may not call.
 */
drop policy if exists settings_public_select on public.app_settings;

create policy settings_public_select on public.app_settings for select to anon
  using (public_read);

create policy settings_member_select on public.app_settings for select to authenticated
  using (public_read or (select public.is_admin()));

/**
 * The refund rule, readable by everybody who is asked to agree to it.
 *
 * It was inserted without `public_read` (202608160010), so only an admin could
 * read it — and the app's buy screen reads it as the buyer. A buyer therefore
 * got no policy, was never shown the agreement, and `order_create_marketplace`
 * then refused the order for want of one. /refund shows this same setting
 * rather than a second copy of its words, which needs the same read.
 *
 * Its English is filled in where an operator has not written one, because the
 * English page is the one App Review reads. An existing translation wins.
 */
update public.app_settings
   set public_read = true,
       value = jsonb_set(
         case when value ? 'i18n' then value else value || '{"i18n": {}}'::jsonb end,
         '{i18n,en}',
         jsonb_build_object(
           'title', 'PPTX products are non-refundable',
           'body', 'Products in the marketplace are digital files. Once a purchase is confirmed, the file is added to your account immediately and cannot technically be returned. For this reason, payments are not refunded after purchase. If a product does not match its description or the file does not open, contact support.',
           'checkbox_label', 'I understand that this is a digital product and that it cannot be returned after purchase.'
         ) || coalesce(value -> 'i18n' -> 'en', '{}'::jsonb)
       )
 where key = 'marketplace.refund_policy';

insert into public.app_settings (key, value, description, public_read)
values (
  'site.contacts',
  jsonb_build_object(
    'company_name', '', 'stir', '', 'address', '',
    'support_email', '', 'phone', '', 'telegram', ''
  ),
  'Contact details the legal pages on the site quote ({{support_email}} and the rest). An empty field is left off the pages.',
  -- Shown on a public page; nothing here is a secret.
  true
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- tables --

create table public.site_pages (
  slug text primary key
    check (slug in ('privacy', 'terms', 'support', 'delete-account', 'refund')),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000),
  title_i18n jsonb not null default '{}'::jsonb,
  body_i18n jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  version integer not null default 0 check (version >= 0),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint site_pages_title_i18n check (public.is_i18n_object(title_i18n) and not title_i18n ? 'uz'),
  constraint site_pages_body_i18n check (public.is_i18n_object(body_i18n) and not body_i18n ? 'uz'),
  -- A page on the site has words and a version to point back to.
  constraint site_pages_published_whole check (
    status = 'draft'
    or (version > 0 and published_at is not null and btrim(title) <> '' and btrim(body) <> '')
  )
);

comment on table public.site_pages is
  'The legal pages on jaxongirman.app, one row per address, holding the live text. Written only by admin_* RPCs.';

create trigger site_pages_set_updated_at
  before update on public.site_pages
  for each row execute function public.set_updated_at();

create table public.site_page_drafts (
  slug text primary key references public.site_pages(slug) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 100000),
  title_i18n jsonb not null default '{}'::jsonb,
  body_i18n jsonb not null default '{}'::jsonb,
  -- The live version this draft was written over, so the console can say so.
  base_version integer not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id) on delete set null,
  constraint site_page_drafts_title_i18n check (public.is_i18n_object(title_i18n) and not title_i18n ? 'uz'),
  constraint site_page_drafts_body_i18n check (public.is_i18n_object(body_i18n) and not body_i18n ? 'uz')
);

create table public.site_page_versions (
  id bigserial primary key,
  slug text not null references public.site_pages(slug) on delete cascade,
  version integer not null check (version > 0),
  title text not null,
  body text not null,
  title_i18n jsonb not null default '{}'::jsonb,
  body_i18n jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  reason text,
  -- Set when this version is an older one published again.
  reverted_from integer,
  unique (slug, version)
);

comment on table public.site_page_versions is
  'Every text a legal page has ever shown, in full. Append-only: a revert is a new version.';

alter table public.site_pages enable row level security;

alter table public.site_page_drafts enable row level security;

alter table public.site_page_versions enable row level security;

/**
 * What the site reads: the published pages, and nothing else.
 *
 * Drafts and history have no policy at all. The console reads them through
 * `admin_site_pages` and `admin_site_page_versions`, which check the role
 * themselves — so no select here needs an `or is_admin()` clause, and anon is
 * never asked to evaluate one.
 */
create policy site_pages_published_read on public.site_pages for select to anon, authenticated
  using (status = 'published');

revoke all on public.site_pages, public.site_page_drafts, public.site_page_versions from anon, authenticated;

grant select on public.site_pages to anon, authenticated;

grant all on public.site_pages, public.site_page_drafts, public.site_page_versions to service_role;

grant usage on sequence public.site_page_versions_id_seq to service_role;

-- --------------------------------------------------------------- helpers --

/**
 * English and Russian, cleaned: only those two keys, only text, and a blank
 * translation removed so the site falls back to Uzbek rather than to nothing.
 */
create or replace function public.site_page_translations(p_value jsonb, p_limit integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
  v_clean jsonb := '{}'::jsonb;
  v_entry record;
  v_text text;
begin
  if jsonb_typeof(v_value) <> 'object' then
    raise exception 'translations must be an object' using errcode = '22023';
  end if;
  for v_entry in select key, value from jsonb_each(v_value) loop
    if v_entry.key not in ('en', 'ru') or jsonb_typeof(v_entry.value) <> 'string' then
      raise exception 'translations take only en and ru text' using errcode = '22023';
    end if;
    v_text := btrim(v_entry.value #>> '{}');
    if char_length(v_text) > p_limit then
      raise exception 'translation is too long' using errcode = '22023';
    end if;
    if v_text <> '' then
      v_clean := v_clean || jsonb_build_object(v_entry.key, v_text);
    end if;
  end loop;
  return v_clean;
end;
$$;

/** Who did something, the way the console names a person. */
create or replace function public.site_page_person(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(profile.full_name), ''), profile.username, account.email, '')
    from auth.users account
    left join public.profiles profile on profile.id = account.id
   where account.id = p_user;
$$;

revoke all on function public.site_page_translations(jsonb, integer) from public, anon, authenticated;

revoke all on function public.site_page_person(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ reads --

/** The console's list: every page, its live text, and the draft over it. */
create or replace function public.admin_site_pages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(page)
        || jsonb_build_object(
          'updated_by_name', public.site_page_person(page.updated_by),
          'draft', case when draft.slug is null then null else
            to_jsonb(draft) || jsonb_build_object('saved_by_name', public.site_page_person(draft.saved_by))
          end
        )
      order by array_position(array['privacy', 'terms', 'support', 'delete-account', 'refund'], page.slug)
    )
    from public.site_pages page
    left join public.site_page_drafts draft on draft.slug = page.slug
  ), '[]'::jsonb);
end;
$$;

/** One page's history, newest first, each version whole. */
create or replace function public.admin_site_page_versions(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(entry) || jsonb_build_object('published_by_name', public.site_page_person(entry.published_by))
      order by entry.version desc
    )
    from public.site_page_versions entry
    where entry.slug = p_slug
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------- writes --

/**
 * Keeps work in progress without publishing it.
 *
 * One draft per page, overwritten on every save. The live row is not touched,
 * which is the point: the address stays up while the words are argued over.
 */
create or replace function public.admin_save_site_page(
  p_slug text,
  p_title text,
  p_body text,
  p_title_i18n jsonb default '{}'::jsonb,
  p_body_i18n jsonb default '{}'::jsonb,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_page public.site_pages%rowtype;
  v_before public.site_page_drafts%rowtype;
  v_after public.site_page_drafts%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_page from public.site_pages where slug = p_slug for update;
  if not found then
    raise exception 'unknown site page %', p_slug using errcode = 'P0002';
  end if;
  if char_length(v_title) > 200 or char_length(v_body) > 100000 then
    raise exception 'title or text is too long' using errcode = '22023';
  end if;

  select * into v_before from public.site_page_drafts where slug = p_slug;

  insert into public.site_page_drafts (slug, title, body, title_i18n, body_i18n, base_version, saved_at, saved_by)
  values (
    p_slug, v_title, v_body,
    public.site_page_translations(p_title_i18n, 200),
    public.site_page_translations(p_body_i18n, 100000),
    v_page.version, now(), v_admin
  )
  on conflict (slug) do update set
    title = excluded.title,
    body = excluded.body,
    title_i18n = excluded.title_i18n,
    body_i18n = excluded.body_i18n,
    base_version = excluded.base_version,
    saved_at = excluded.saved_at,
    saved_by = excluded.saved_by
  returning * into v_after;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'site_page.draft_saved', 'site_page', p_slug,
    case when v_before.slug is null then null
      else jsonb_build_object('base_version', v_before.base_version, 'title', v_before.title, 'saved_at', v_before.saved_at) end,
    jsonb_build_object('base_version', v_after.base_version, 'title', v_after.title, 'body_length', char_length(v_after.body)),
    nullif(left(btrim(coalesce(p_reason, '')), 500), '')
  );

  return to_jsonb(v_after);
end;
$$;

/**
 * Puts a text on the site.
 *
 * The text arrives with the call rather than being read from the saved draft,
 * so what the person was looking at when they pressed the button is what goes
 * live, in one transaction with its version row and its audit row.
 *
 * `p_base_version` is the version the editor was opened on. If somebody else
 * published since, this refuses rather than silently replacing their words.
 */
create or replace function public.admin_publish_site_page(
  p_slug text,
  p_title text,
  p_body text,
  p_title_i18n jsonb default '{}'::jsonb,
  p_body_i18n jsonb default '{}'::jsonb,
  p_reason text default '',
  p_base_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.site_pages%rowtype;
  v_after public.site_pages%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_title_i18n jsonb;
  v_body_i18n jsonb;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Nashr sababini yozing.' using errcode = '22023';
  end if;
  v_title_i18n := public.site_page_translations(p_title_i18n, 200);
  v_body_i18n := public.site_page_translations(p_body_i18n, 100000);

  select * into v_before from public.site_pages where slug = p_slug for update;
  if not found then
    raise exception 'unknown site page %', p_slug using errcode = 'P0002';
  end if;
  if p_base_version is not null and p_base_version <> v_before.version then
    raise exception 'Sahifa siz ochganingizdan keyin yangilangan (hozir v%). Sahifani qayta yuklang.', v_before.version
      using errcode = '40001', detail = 'site_page_changed';
  end if;
  if v_title = '' or v_body = '' then
    raise exception 'O‘zbekcha sarlavha va matn bo‘sh bo‘lmasin.' using errcode = '22023';
  end if;
  if char_length(v_title) > 200 or char_length(v_body) > 100000 then
    raise exception 'title or text is too long' using errcode = '22023';
  end if;
  if v_before.status = 'published'
     and v_before.title = v_title and v_before.body = v_body
     and v_before.title_i18n = v_title_i18n and v_before.body_i18n = v_body_i18n then
    raise exception 'Saytdagi matndan farqi yo‘q — nashr qilinadigan o‘zgarish yo‘q.' using errcode = '22023';
  end if;

  update public.site_pages set
    title = v_title,
    body = v_body,
    title_i18n = v_title_i18n,
    body_i18n = v_body_i18n,
    status = 'published',
    version = v_before.version + 1,
    published_at = now(),
    updated_by = v_admin
  where slug = p_slug
  returning * into v_after;

  insert into public.site_page_versions (slug, version, title, body, title_i18n, body_i18n, published_at, published_by, reason)
  values (p_slug, v_after.version, v_title, v_body, v_title_i18n, v_body_i18n, v_after.published_at, v_admin, v_reason);

  -- Whatever was being drafted has now either gone live or been superseded.
  delete from public.site_page_drafts where slug = p_slug;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'site_page.published', 'site_page', p_slug,
    jsonb_build_object('version', v_before.version, 'title', v_before.title, 'published_at', v_before.published_at),
    jsonb_build_object('version', v_after.version, 'title', v_after.title, 'published_at', v_after.published_at),
    v_reason
  );

  return to_jsonb(v_after);
end;
$$;

/**
 * Puts an earlier text back on the site.
 *
 * It is published again as a new version rather than by winding the counter
 * back, so the history keeps the text that was replaced and says that the
 * new one is a copy. A pending draft is dropped: it was written over the text
 * this replaces, and publishing it later would quietly undo the revert.
 */
create or replace function public.admin_revert_site_page(
  p_slug text,
  p_version integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.site_pages%rowtype;
  v_after public.site_pages%rowtype;
  v_source public.site_page_versions%rowtype;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_had_draft boolean;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Qaytarish sababini yozing.' using errcode = '22023';
  end if;

  select * into v_before from public.site_pages where slug = p_slug for update;
  if not found then
    raise exception 'unknown site page %', p_slug using errcode = 'P0002';
  end if;
  select * into v_source from public.site_page_versions where slug = p_slug and version = p_version;
  if not found then
    raise exception 'version % of % not found', p_version, p_slug using errcode = 'P0002';
  end if;
  if v_before.status = 'published'
     and v_before.title = v_source.title and v_before.body = v_source.body
     and v_before.title_i18n = v_source.title_i18n and v_before.body_i18n = v_source.body_i18n then
    raise exception 'Bu matn allaqachon saytda.' using errcode = '22023';
  end if;

  update public.site_pages set
    title = v_source.title,
    body = v_source.body,
    title_i18n = v_source.title_i18n,
    body_i18n = v_source.body_i18n,
    status = 'published',
    version = v_before.version + 1,
    published_at = now(),
    updated_by = v_admin
  where slug = p_slug
  returning * into v_after;

  insert into public.site_page_versions (
    slug, version, title, body, title_i18n, body_i18n, published_at, published_by, reason, reverted_from
  ) values (
    p_slug, v_after.version, v_source.title, v_source.body, v_source.title_i18n, v_source.body_i18n,
    v_after.published_at, v_admin, v_reason, p_version
  );

  delete from public.site_page_drafts where slug = p_slug;
  v_had_draft := found;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'site_page.reverted', 'site_page', p_slug,
    jsonb_build_object('version', v_before.version, 'title', v_before.title, 'discarded_draft', v_had_draft),
    jsonb_build_object('version', v_after.version, 'title', v_after.title, 'reverted_from', p_version),
    v_reason
  );

  return to_jsonb(v_after);
end;
$$;

/**
 * The contact details every page quotes.
 *
 * Checked here rather than trusted from the form: a mistyped email or a STIR
 * with a letter in it would otherwise be published on five pages at once.
 * Telegram is kept as the bare username, whichever way it was typed.
 */
create or replace function public.admin_set_site_contacts(p_contacts jsonb, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_fields constant text[] := array['company_name', 'stir', 'address', 'support_email', 'phone', 'telegram'];
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_input jsonb := coalesce(p_contacts, '{}'::jsonb);
  v_before jsonb;
  v_after jsonb := '{}'::jsonb;
  v_field text;
  v_value text;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'O‘zgarish sababini yozing.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'contacts must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(v_input) entry
     where not (entry.key = any (v_fields)) or jsonb_typeof(entry.value) <> 'string'
  ) then
    raise exception 'unknown contact field' using errcode = '22023';
  end if;

  select value into v_before from public.app_settings where key = 'site.contacts' for update;
  v_before := coalesce(v_before, '{}'::jsonb);

  foreach v_field in array v_fields loop
    v_value := btrim(coalesce(v_input ->> v_field, v_before ->> v_field, ''));
    if char_length(v_value) > 300 then
      raise exception '% is too long', v_field using errcode = '22023';
    end if;

    if v_value <> '' then
      if v_field = 'support_email' and v_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'Email manzil noto‘g‘ri.' using errcode = '22023';
      elsif v_field = 'stir' then
        v_value := regexp_replace(v_value, '\s', '', 'g');
        if v_value !~ '^[0-9]{9}$' then
          raise exception 'STIR 9 ta raqamdan iborat bo‘lishi kerak.' using errcode = '22023';
        end if;
      elsif v_field = 'phone' and v_value !~ '^\+?[0-9][0-9 ()-]{6,24}$' then
        raise exception 'Telefon raqami noto‘g‘ri.' using errcode = '22023';
      elsif v_field = 'telegram' then
        v_value := regexp_replace(v_value, '^(https?://)?(www\.)?(t\.me|telegram\.me)/', '', 'i');
        v_value := regexp_replace(v_value, '^@', '');
        if v_value !~ '^[A-Za-z0-9_]{5,32}$' then
          raise exception 'Telegram foydalanuvchi nomi noto‘g‘ri.' using errcode = '22023';
        end if;
      end if;
    end if;

    v_after := v_after || jsonb_build_object(v_field, v_value);
  end loop;

  insert into public.app_settings (key, value, description, public_read, updated_by)
  values ('site.contacts', v_after, 'Contact details the legal pages on the site quote ({{support_email}} and the rest). An empty field is left off the pages.', true, v_admin)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'site.contacts.updated', 'app_setting', 'site.contacts', v_before, v_after, v_reason);

  return v_after;
end;
$$;

revoke all on function public.admin_site_pages() from public, anon;

revoke all on function public.admin_site_page_versions(text) from public, anon;

revoke all on function public.admin_save_site_page(text, text, text, jsonb, jsonb, text) from public, anon;

revoke all on function public.admin_publish_site_page(text, text, text, jsonb, jsonb, text, integer) from public, anon;

revoke all on function public.admin_revert_site_page(text, integer, text) from public, anon;

revoke all on function public.admin_set_site_contacts(jsonb, text) from public, anon;

grant execute on function public.admin_site_pages() to authenticated;

grant execute on function public.admin_site_page_versions(text) to authenticated;

grant execute on function public.admin_save_site_page(text, text, text, jsonb, jsonb, text) to authenticated;

grant execute on function public.admin_publish_site_page(text, text, text, jsonb, jsonb, text, integer) to authenticated;

grant execute on function public.admin_revert_site_page(text, integer, text) to authenticated;

grant execute on function public.admin_set_site_contacts(jsonb, text) to authenticated;

-- ------------------------------------------------------------------- seed --
/**
 * The first texts, published at once so no store URL ever answers 404.
 *
 * Every statement in them was checked against this repository: what the
 * tables hold, which functions call which provider, what `purge_account_data`
 * deletes and keeps. Nothing about the operator is written here — the legal
 * name, STIR, address and contacts come from `site.contacts`, and the lines
 * that quote them stay off the page until they are filled in.
 *
 * Russian is left empty on purpose; the site shows the Uzbek until an admin
 * writes it.
 */
insert into public.site_pages (slug, title, body, title_i18n, body_i18n, status, version, published_at)
values
(
  'privacy',
  'Maxfiylik siyosati',
  $privacy_uz$
Bu siyosat Jaxongirman mobil ilovasi va jaxongirman.app sayti (keyingi o‘rinlarda — «Xizmat») qanday ma’lumotlarni yig‘ishi, ulardan nima uchun foydalanishi, kimga uzatishi, qancha saqlashi va qanday o‘chirishini tushuntiradi.

- Xizmat egasi: {{company_name}}
- STIR: {{stir}}

## Qisqacha

- Reklama ko‘rsatmaymiz va ma’lumotlaringizni sotmaymiz.
- Ilovada kuzatuv (tracking), reklama identifikatori (IDFA, GAID) va uchinchi tomon analitika vositalari yo‘q.
- Siz yozgan matn va yuklagan fayllar faqat siz so‘ragan natijani tayyorlash uchun ishlatiladi.
- Akkauntingizni istalgan vaqtda ilovaning o‘zida o‘chirishingiz mumkin.

## Qanday ma’lumotlar yig‘iladi

### Akkaunt va profil

- **Kirish ma’lumotlari:** email manzil. Apple yoki Google orqali kirsangiz — shu xizmat bergan email va ism. Email va parol bilan ro‘yxatdan o‘tsangiz, parol faqat shifrlangan (hash) ko‘rinishda saqlanadi.
- **Profil:** ism va familiya, foydalanuvchi nomi, o‘zingiz haqingizda qisqa matn, avatar, o‘qish yoki ish joyi va yo‘nalishi, ilova tili va vaqt mintaqasi.

### Siz yaratadigan kontent

- **Taqdimotlar:** mavzu va ko‘rsatmalar, slaydlar matni va rasmlari, siz yuklagan fayllar (PDF, DOCX, matn, rasm, PPTX) hamda eksport qilingan PDF va PPTX fayllar.
- **Hujjatlar:** ilmiy va mustaqil ishlar, taqdimot himoyasi matnlari.
- **Obyektivka:** siz kiritgan ma’lumotlar — F.I.Sh., tug‘ilgan yil va joy, millat, partiyaviylik, ma’lumoti va mutaxassisligi, ilmiy daraja va unvon, mukofotlar, mehnat faoliyati, qarindoshlar haqidagi ma’lumotlar (qarindoshlik darajasi, ism, tug‘ilgan yil, ish joyi, manzil) va 3×4 surat. Bu ma’lumotlar faqat hujjatingizni tayyorlash uchun saqlanadi va sun’iy intellekt xizmatlariga yuborilmaydi. Qarindoshlaringiz ma’lumotini kiritishdan oldin ularning roziligini oling.
- **3×4 surat varag‘i:** siz yuklagan surat.

### Ma’lumotlarni yig‘ish (so‘rovnomalar)

- **So‘rovnoma yaratsangiz:** savollar, sozlamalar va kelgan javoblar.
- **So‘rovnomaga javob bersangiz:** javoblaringiz, so‘rovnoma so‘ragan bo‘lsa — telefon raqami va yuklangan rasmlar. So‘rovnoma egasi javoblaringiz bilan birga ismingiz va foydalanuvchi nomingizni ko‘radi.
- Javoblar belgilangan saqlash muddati tugagach avtomatik o‘chiriladi; aniq muddat javob berish ekranida ko‘rsatiladi.
- Hozirgi standart saqlash muddati: {{survey_retention_hours}} soat.
- So‘rovnoma egasi javoblarni XLSX yoki CSV fayl sifatida yuklab olishi mumkin. Yuklab olingan fayl uchun so‘rovnoma egasi javobgar — [Foydalanish shartlari](/terms)ga qarang.
- Administratorlar so‘rovnoma javoblarini o‘qiy olmaydi.

### O‘yingoh

- O‘yinga qo‘shilganda: taxallusingiz, tanlagan avataringiz, javoblaringiz, ballingiz va o‘rningiz. Taxallus va natijalar o‘yin davomida umumiy ekranda va boshqa ishtirokchilarga ko‘rinadi.
- O‘zingiz yaratgan o‘yinlar va savollar.

### Do‘kon

- Mahsulot joylasangiz: mahsulot nomi, tavsifi, muqovasi va fayli. Mahsulot sahifasida ismingiz sotuvchi sifatida ko‘rsatiladi.
- Sotuvchi sifatida hisob-kitob uchun kiritgan telefon raqamingiz va Telegram foydalanuvchi nomingiz.
- Xaridlar va sotuvlar tarixi.

### To‘lovlar va J Tanga

- **Buyurtmalar:** buyurtma raqami, nima uchunligi, summa, holat va sanalar.
- **J Tanga harakatlari:** hisobga tushgan, sarflangan, o‘tkazilgan va qaytarilgan tangalar tarixi.
- **Bank kartasi:** to‘lov paytida karta raqami va amal qilish muddati to‘g‘ridan-to‘g‘ri to‘lov provayderi Payme’ga uzatiladi. Biz karta raqamini, CVV kodini va SMS tasdiqlash kodini saqlamaymiz. Faqat kartaning yashirilgan ko‘rinishi, oxirgi 4 raqami va amal qilish muddati saqlanadi.

### Qurilmalar va xavfsizlik

- Har bir kirilgan qurilma uchun: platforma (iOS, Android yoki veb), qurilma yoki brauzer nomi, ilova versiyasi, kirgan va oxirgi faol bo‘lgan vaqt. Bu ro‘yxatni Profil → Sozlamalar → Qurilmalar bo‘limida ko‘rasiz va istalgan qurilmani chiqarib yuborishingiz mumkin.
- Kirish xizmati xavfsizlik uchun sessiyaga tegishli IP manzil va brauzer yoki qurilma ma’lumotini (user agent) qayd etadi.

### Yordam murojaatlari

- Murojaat mavzusi, yozishmalar, ilova qilingan skrinshotlar va ko‘rsatsangiz — buyurtma yoki tranzaksiya raqami.

### Boshqa

- **Bildirishnomalar:** ilova ichidagi xabarlar (masalan, murojaatingizga javob keldi). Push-bildirishnoma xizmatlari ishlatilmaydi.
- **Telegram orqali rasm tanlash (ixtiyoriy):** slayd uchun rasmni Telegram bot orqali tanlasangiz, Telegram foydalanuvchi va chat identifikatori hamda qidiruv so‘rovi saqlanadi. Bunday sessiya 15 daqiqa amal qiladi.
- **Talabalar marafoni (faqat marafon o‘tkaziladigan davrda):** qatnashganingiz va kimga ovoz berganingiz. Kim ovoz bergani nomzodga ko‘rsatilmaydi.
- **Texnik yozuvlar:** sun’iy intellekt so‘rovlari soni, davomiyligi va xarajati — xizmat ishlashini kuzatish uchun.

## Nima yig‘ilmaydi

- Joylashuv (geolokatsiya) va kontaktlar ro‘yxati.
- Ovoz yozuvlari: ilova mikrofondan foydalanmaydi.
- Reklama identifikatori va boshqa ilova yoki saytlar bo‘ylab kuzatuv ma’lumotlari.
- Kamera faqat QR kodni skanerlash uchun ishlatiladi; kadrlar saqlanmaydi va hech qayerga yuborilmaydi.
- Galereyaga faqat siz tanlagan rasmni yuklash uchun murojaat qilinadi.

## Ma’lumotlardan nima uchun foydalanamiz

- Akkauntingizni yaratish, sizni tanish va Xizmatni ko‘rsatish.
- Siz so‘ragan taqdimot, hujjat va o‘yin savollarini sun’iy intellekt yordamida tayyorlash.
- To‘lovlarni amalga oshirish, J Tanga balansini yuritish va buxgalteriya hisobini olib borish.
- Yordam murojaatlariga javob berish.
- Xavfsizlik: suiiste’mol va firibgarlikning oldini olish, bepul boshlang‘ich imkoniyatlarni qayta-qayta olishga yo‘l qo‘ymaslik.
- Xizmat ishlashini kuzatish va xatolarni tuzatish.

Ma’lumotlaringizdan reklama, marketing profili tuzish yoki boshqa kompaniyalarga sotish uchun foydalanmaymiz.

## Ma’lumotlar kimga uzatiladi

Ma’lumotlar faqat Xizmatni ko‘rsatish uchun zarur hajmda quyidagi provayderlarga uzatiladi:

| Provayder | Nima uchun | Qanday ma’lumot |
|---|---|---|
| Supabase | Ma’lumotlar bazasi, kirish, fayllarni saqlash va server funksiyalari | Yuqorida sanalgan ma’lumotlar |
| Vercel | jaxongirman.app saytini joylashtirish | Saytga so‘rovlar (IP manzil, brauzer) |
| Google (Gemini API) | Taqdimot, hujjat va o‘yin savollarini yozish va tahrirlash, mavzu bo‘yicha internetdan ma’lumot izlash | Siz yozgan mavzu, ko‘rsatma va tahrirlanayotgan matn, sun’iy intellektga berilgan fayllar mazmuni |
| Unsplash, Wikimedia Commons, Wikidata, Openverse | Slaydlar uchun rasm izlash | Mavzudan olingan qidiruv so‘zlari (shaxsingiz haqida ma’lumot yuborilmaydi) |
| Payme | To‘lovlarni qabul qilish | Karta raqami va amal qilish muddati, summa, buyurtma raqami |
| Telegram | Rasm tanlash boti (ixtiyoriy) | Qidiruv so‘rovi va bot ko‘rsatadigan rasmlar |
| Apple, Google | «Apple bilan kirish», «Google bilan kirish» | Kirishni tasdiqlash; ular bizga email va ismingizni beradi |

Sun’iy intellektga yuboriladigan matnga keraksiz shaxsiy ma’lumot (telefon raqami, boshqa odamlar haqidagi ma’lumot va hokazo) yozmang.

Provayderlarning serverlari O‘zbekistondan tashqarida joylashgan bo‘lishi mumkin. Qonunda belgilangan hollarda ma’lumotlar vakolatli davlat organlarining so‘roviga ko‘ra berilishi mumkin.

## Qancha saqlanadi

- **Akkaunt va kontent:** akkauntingiz mavjud ekan yoki o‘zingiz o‘chirmaguningizcha.
- **So‘rovnoma javoblari:** belgilangan muddat tugagach avtomatik o‘chiriladi.
- **To‘lov, buyurtma va J Tanga yozuvlari:** buxgalteriya va soliq qonunchiligi talab qiladigan muddat davomida — akkaunt o‘chirilgandan keyin ham, lekin sizni aniqlab bo‘lmaydigan ko‘rinishda.
- **Yordam murojaatlari va qurilmalar ro‘yxati:** akkaunt o‘chirilguncha.

## Akkauntni o‘chirish

Ilovada: Profil → Hisob → «Hisobni o‘chirish». Nima o‘chishi va nima qolishi [Akkauntni o‘chirish](/delete-account) sahifasida batafsil yozilgan.

## Sizning huquqlaringiz

- Profil ma’lumotlarini istalgan vaqtda ilovada o‘zgartirish.
- O‘z kontentingizni (taqdimot, o‘yin, so‘rovnoma va boshqalar) o‘chirish.
- Akkauntni butunlay o‘chirish.
- Sizga tegishli ma’lumotlar haqida so‘rash yoki ularning nusxasini olish — Yordam markazi orqali murojaat qiling.

## Bolalar

Xizmatdan 13 yoshdan boshlab foydalanish mumkin. 16 yoshga to‘lmagan foydalanuvchilar Xizmatdan ota-onasi yoki qonuniy vakilining roziligi bilan foydalanadi. 13 yoshga to‘lmagan bolaning ma’lumoti yig‘ilganini bilsak, uni o‘chiramiz.

## Xavfsizlik

- Barcha ulanishlar shifrlangan (HTTPS).
- Fayllar yopiq omborlarda saqlanadi va qisqa muddatli havolalar orqali ochiladi.
- Har bir foydalanuvchi ma’lumotlar bazasida faqat o‘z ma’lumotlarini ko‘ra oladi.
- Ma’lumotlarni o‘zgartiradigan administrator amallari jurnalga yoziladi.

## Sayt va cookie fayllar

jaxongirman.app reklama yoki kuzatuv cookie fayllaridan foydalanmaydi. Saytda tizimga kirsangiz, sessiyangiz brauzeringiz xotirasida (localStorage) saqlanadi.

## O‘zgarishlar

Siyosat o‘zgarsa, shu sahifa yangilanadi va pastdagi sana o‘zgaradi. Muhim o‘zgarishlar haqida ilova orqali xabar beramiz.

## Bog‘lanish

- Ilovada: Profil → Yordam markazi → «Yangi murojaat»
- Email: {{support_email}}
- Telefon: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Manzil: {{address}}
$privacy_uz$,
  jsonb_build_object('en', 'Privacy Policy'),
  jsonb_build_object('en', $privacy_en$
This policy explains what information the Jaxongirman mobile app and the jaxongirman.app website (together, the “Service”) collect, why, who it is shared with, how long it is kept and how it is deleted.

- Operator: {{company_name}}
- Taxpayer ID (STIR): {{stir}}

## In short

- We do not show ads and we do not sell your data.
- The app contains no tracking, no advertising identifier (IDFA, GAID) and no third-party analytics.
- The text you write and the files you upload are used only to produce the result you asked for.
- You can delete your account at any time inside the app.

## What we collect

### Account and profile

- **Sign-in details:** your email address. If you sign in with Apple or Google, the email and name that service provides. If you register with an email and password, the password is stored only as a hash.
- **Profile:** first and last name, username, a short bio, avatar, place of study or work and field, app language and time zone.

### Content you create

- **Presentations:** topics and instructions, slide text and images, files you upload (PDF, DOCX, text, images, PPTX) and exported PDF and PPTX files.
- **Documents:** academic and independent papers, presentation defense speeches.
- **Obyektivka (CV form):** what you enter — full name, year and place of birth, nationality, party membership, education and speciality, academic degree and title, awards, work history, details of relatives (relationship, name, year of birth, workplace, address) and a 3×4 photo. This is stored only to produce your document and is never sent to AI services. Ask your relatives for consent before entering their details.
- **3×4 photo sheets:** the photo you upload.

### Data collection (surveys)

- **If you create a survey:** its questions, settings and the responses it receives.
- **If you answer a survey:** your answers and, where the survey asks for them, a phone number and uploaded images. The survey owner sees your answers together with your name and username.
- Responses are deleted automatically when their retention period ends; the exact period is shown on the answer screen.
- Current default retention period: {{survey_retention_hours}} hours.
- The survey owner can download responses as an XLSX or CSV file and is responsible for that file — see the [Terms of Use](/terms?lang=en).
- Administrators cannot read survey answers.

### O‘yingoh (live quiz)

- When you join a game: your nickname, chosen avatar, answers, score and rank. Your nickname and results are shown on the shared screen and to other players during the game.
- Games and questions you create.

### Marketplace

- If you list a product: its title, description, cover and file. Your name is shown on the product page as the seller.
- As a seller, the phone number and Telegram username you provide for payouts.
- Purchase and sales history.

### Payments and J Tanga

- **Orders:** order number, what it was for, amount, status and dates.
- **J Tanga activity:** coins credited, spent, transferred and returned.
- **Bank card:** during a payment, the card number and expiry date go directly to the payment provider, Payme. We do not store the card number, the CVV or the SMS confirmation code — only a masked form of the card, its last 4 digits and its expiry date.

### Devices and security

- For each signed-in device: platform (iOS, Android or web), device or browser name, app version, sign-in and last-active time. You can see this list under Profile → Settings → Devices and sign out any device from there.
- The sign-in service records the IP address and browser or device information (user agent) of a session for security.

### Support requests

- The subject, the conversation, attached screenshots and, if you provide them, an order or transaction number.

### Other

- **Notifications:** in-app messages (for example, that your support request has a reply). No push notification services are used.
- **Picking images through Telegram (optional):** if you choose a slide image through our Telegram bot, your Telegram user and chat identifiers and the search query are stored. Such a session lasts 15 minutes.
- **Student marathon (only while a marathon is running):** your participation and whom you voted for. Voters are not shown to the candidate.
- **Technical records:** the number, duration and cost of AI requests, to monitor how the Service works.

## What we do not collect

- Location or contacts.
- Audio recordings: the app does not use the microphone.
- Advertising identifiers or tracking data across other apps and websites.
- The camera is used only to scan QR codes; frames are not stored or sent anywhere.
- The photo library is accessed only to upload an image you choose.

## Why we use it

- To create your account, recognise you and provide the Service.
- To produce the presentations, documents and quiz questions you request with the help of AI.
- To process payments, keep your J Tanga balance and maintain accounting records.
- To answer support requests.
- For security: preventing abuse and fraud and stopping the free starter allowance from being claimed repeatedly.
- To monitor the Service and fix errors.

We do not use your data for advertising or marketing profiles, and we do not sell it.

## Who we share it with

Data is shared only with the following providers, and only as far as needed to run the Service:

| Provider | Purpose | Data |
|---|---|---|
| Supabase | Database, sign-in, file storage and server functions | The data listed above |
| Vercel | Hosting the jaxongirman.app website | Requests to the website (IP address, browser) |
| Google (Gemini API) | Writing and editing presentations, documents and quiz questions; searching the web on a topic | Your topic, instructions and the text being edited; the contents of files you give to the AI |
| Unsplash, Wikimedia Commons, Wikidata, Openverse | Finding images for slides | Search words taken from the topic (nothing about you) |
| Payme | Processing payments | Card number and expiry date, amount, order number |
| Telegram | Image picker bot (optional) | Your search query and the images the bot shows |
| Apple, Google | “Sign in with Apple”, “Sign in with Google” | Confirming your sign-in; they give us your email and name |

Do not put unnecessary personal information (phone numbers, details about other people and so on) into text you send to the AI.

Providers’ servers may be located outside Uzbekistan. Where the law requires it, data may be disclosed at the request of competent authorities.

## How long we keep it

- **Account and content:** for as long as your account exists or until you delete it.
- **Survey responses:** deleted automatically when their retention period ends.
- **Payment, order and J Tanga records:** for as long as accounting and tax law requires — including after the account is deleted, but in a form that no longer identifies you.
- **Support requests and the device list:** until the account is deleted.

## Deleting your account

In the app: Profile → Account → “Delete account”. What is deleted and what is kept is described on the [Delete your account](/delete-account?lang=en) page.

## Your rights

- Change your profile details in the app at any time.
- Delete your own content (presentations, games, surveys and so on).
- Delete your account entirely.
- Ask about the data we hold about you or request a copy — contact us through the Help center.

## Children

You must be at least 13 years old to use the Service. Users under 16 may use it only with the consent of a parent or legal guardian. If we learn that we have collected data from a child under 13, we will delete it.

## Security

- All connections are encrypted (HTTPS).
- Files are kept in private storage and opened through short-lived links.
- In the database, each user can read only their own data.
- Administrator actions that change data are logged.

## Website and cookies

jaxongirman.app does not use advertising or tracking cookies. If you sign in on the website, your session is kept in your browser’s storage (localStorage).

## Changes

If this policy changes, this page is updated and the date below changes. We will tell you about significant changes in the app.

## Contact

- In the app: Profile → Help center → “New request”
- Email: {{support_email}}
- Phone: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Address: {{address}}
$privacy_en$),
  'published', 1, now()
),
(
  'terms',
  'Foydalanish shartlari',
  $terms_uz$
Bu shartlar Jaxongirman mobil ilovasi va jaxongirman.app saytidan (keyingi o‘rinlarda — «Xizmat») foydalanish qoidalarini belgilaydi. Xizmatdan foydalanib, siz shu shartlarga va [Maxfiylik siyosati](/privacy)ga rozilik bildirasiz.

- Xizmat egasi: {{company_name}}
- STIR: {{stir}}

## 1. Akkaunt

- Xizmatdan 13 yoshdan boshlab foydalanish mumkin. 16 yoshga to‘lmagan bo‘lsangiz, ota-onangiz yoki qonuniy vakilingiz roziligi kerak.
- Ro‘yxatdan o‘tishda to‘g‘ri ma’lumot kiriting. Akkaunt shaxsiy: uni boshqalarga bermang va kirish ma’lumotlarini sir saqlang.
- Akkauntingizdan bajarilgan harakatlar uchun o‘zingiz javobgarsiz. Begona qurilmani Profil → Sozlamalar → Qurilmalar bo‘limidan chiqarib yuborishingiz mumkin.
- Bepul boshlang‘ich imkoniyatlar bir shaxsga bir marta beriladi. Ularni qayta olish uchun bir nechta akkaunt ochish taqiqlanadi.

## 2. Xizmat nimalarni taklif qiladi

Sun’iy intellekt yordamida taqdimot, ilmiy va mustaqil ish, himoya matni va o‘yin savollarini tayyorlash; taqdimotni telefondan boshqarish; so‘rovnoma orqali ma’lumot yig‘ish (Ma’lumotlarni yig‘ish moduli); jonli bilim o‘yinlari (O‘yingoh); foydalanuvchilar o‘quv materiallarini joylaydigan do‘kon. Xizmat tarkibi vaqt o‘tishi bilan o‘zgarishi mumkin.

## 3. Sun’iy intellekt yaratgan kontent

- Matn, savollar va rasmlar avtomatik tayyorlanadi va xato, noaniq yoki eskirgan ma’lumotni o‘z ichiga olishi mumkin.
- Natijani ishlatishdan oldin faktlar, raqamlar, sanalar va manbalarni o‘zingiz tekshiring. AI natijasi kasbiy (huquqiy, tibbiy, moliyaviy) maslahat emas.
- Slaydlarga qo‘yilgan rasmlar ochiq manbalardan (Unsplash, Wikimedia Commons va boshqalar) olinadi va o‘z litsenziyalari shartlari bilan ishlatiladi.
- Sun’iy intellektdan qonunga zid, kamsituvchi yoki boshqalarning huquqlarini buzadigan kontent yaratish uchun foydalanish taqiqlanadi.

## 4. Akademik halollik

Xizmat o‘qish va ishlashga yordam beradigan vosita. Ta’lim muassasangiz qoidalariga rioya qilish sizning zimmangizda: AI yordamida tayyorlangan ishni qoidalar ruxsat bermagan joyda o‘zingizniki sifatida topshirmang, foydalanilgan manbalarni ko‘rsating, matnni tekshirib, o‘z so‘zlaringiz bilan to‘ldiring. Akademik qoidalarni buzish oqibatlari uchun Xizmat javobgar emas.

## 5. Sizning kontentingiz

- Siz yaratgan va yuklagan kontent sizniki bo‘lib qoladi. Xizmatni ko‘rsatish uchun (saqlash, qayta ishlash, siz tanlagan odamlarga ko‘rsatish) undan foydalanishga ruxsat berasiz.
- Yuklayotgan materialingizga huquqingiz borligiga ishonch hosil qiling.
- Taqiqlanadi: qonunga zid, zo‘ravonlik yoki nafratga undovchi, pornografik kontent; boshqalarning mualliflik huquqi bilan himoyalangan asarlari yoki shaxsiy ma’lumotlarini ularning roziligisiz joylash; zararli fayllar.
- Shartlarni buzgan kontentni yashirish yoki o‘chirish huquqimiz bor.

## 6. J Tanga

- J Tanga — Xizmat ichidagi hisob birligi. U bilan Xizmat ichidagi imkoniyatlar (masalan, taqdimot sahifalari, o‘yinlar, hujjatlar) uchun hisob-kitob qilinadi. Har bir amal necha J Tanga turishi uni bajarishdan oldin ko‘rsatiladi.
- J Tanga pul, elektron pul yoki to‘lov vositasi emas: uni naqd pulga almashtirib yoki hisobdan pul sifatida yechib bo‘lmaydi.
- Tarif bilan berilgan J Tanga bir oy amal qiladi. Tarif muddati tugashidan oldin yangilansa, qolgan tangalar keyingi oyga o‘tadi; yangilanmasa, kuyadi.
- Tarif bilan berilgan J Tangani boshqa foydalanuvchiga o‘tkazib bo‘lmaydi. Boshqa J Tangani boshqa foydalanuvchiga o‘tkazish mumkin; amalga oshirilgan o‘tkazma bekor qilinmaydi.
- Taqdimot yoki boshqa natija tayyorlanmay qolsa, buning uchun band qilingan J Tanga avtomatik qaytariladi.
- Akkaunt o‘chirilganda qolgan J Tanga balansi ham bekor bo‘ladi.

## 7. Do‘kon

- Sotuvchi joylagan materialga (fayl, taqdimot, o‘yin) huquqi borligi va tavsif haqiqatga mosligi uchun javob beradi.
- Mahsulotlar moderatsiyadan o‘tadi; qoidalarni buzgan mahsulot yashirilishi yoki o‘chirilishi mumkin.
- Platforma har bir sotuvdan komissiya oladi; sotuvchiga tegishli ulush hisob-kitob qilinib, unga to‘lanadi.
- Xarid qilingan materialdan shaxsiy va o‘quv maqsadlarida foydalanish mumkin. Uni qayta sotish yoki ommaga tarqatish taqiqlanadi.
- Raqamli mahsulotlarni qaytarish qoidalari [Qaytarish siyosati](/refund) sahifasida.
- Qoidabuzar mahsulot haqida ilova orqali shikoyat qilish mumkin.

## 8. O‘yingoh

- O‘yin tashkilotchisi o‘yin mazmuni va o‘tkazilishi uchun javobgar.
- Ishtirokchilar taxallusi va natijalari umumiy ekranda ko‘rinadi. Haqoratli taxallus ishlatmang.
- Tashkilotchi g‘oliblar uchun J Tanga mukofot qo‘yishi mumkin. Mukofot o‘yin boshlanishida tashkilotchi balansidan band qilinadi va oxirida g‘oliblarga beriladi; o‘yin bekor qilinsa yoki tugamay qolsa, tashkilotchiga qaytariladi.

## 9. Ma’lumotlarni yig‘ish (so‘rovnomalar)

- So‘rovnoma yaratuvchisi respondentlar ma’lumotlari uchun javobgar: faqat kerakli ma’lumotni so‘rang, respondentlarga nima uchun yig‘ayotganingizni tushuntiring va O‘zbekiston Respublikasining shaxsga doir ma’lumotlar to‘g‘risidagi qonunchiligiga rioya qiling.
- Javoblar so‘rovnomada belgilangan muddat o‘tgach avtomatik o‘chiriladi. Undan oldin yuklab olingan XLSX yoki CSV fayllar uchun yaratuvchining o‘zi javobgar: ularni xavfsiz saqlang va keraksiz bo‘lganda o‘chiring.
- Haqoratli, aldovchi yoki qonunga zid so‘rovnomalar yopilishi mumkin.

## 10. Taqiqlangan harakatlar

- Xizmatni buzishga, himoyasini aylanib o‘tishga yoki boshqa foydalanuvchilar ma’lumotlariga kirishga urinish.
- Xizmatni avtomatik vositalar bilan ommaviy so‘rovlarga ko‘mib tashlash yoki undan ma’lumot yig‘ib olish (scraping).
- Limitlar va bepul imkoniyatlarni aylanib o‘tish.
- Boshqa shaxs nomidan harakat qilish.

## 11. Javobgarlikni cheklash

Xizmat «boricha» taqdim etiladi. Uning uzluksiz va xatosiz ishlashini kafolatlay olmaymiz. Qonun ruxsat bergan doirada AI natijasidagi xatolar, ma’lumot yo‘qolishi yoki bilvosita zararlar uchun javobgar emasmiz. Muhim fayllaringizning nusxasini o‘zingizda saqlang.

## 12. Akkauntni to‘xtatish va o‘chirish

Shartlar buzilsa, akkauntni vaqtincha yoki butunlay bloklashimiz mumkin. Siz akkauntingizni istalgan vaqtda ilovada o‘chirishingiz mumkin — [Akkauntni o‘chirish](/delete-account) sahifasiga qarang.

## 13. Shartlarning o‘zgarishi

Shartlar o‘zgarishi mumkin; yangilangan matn shu sahifada e’lon qilinadi va pastdagi sana o‘zgaradi. O‘zgarishdan keyin Xizmatdan foydalanishda davom etish yangi shartlarga rozilikni bildiradi.

## 14. Qo‘llaniladigan qonun

Ushbu shartlarga O‘zbekiston Respublikasi qonunchiligi qo‘llaniladi. Nizolar avvalo muzokara yo‘li bilan hal qilinadi.

## 15. Bog‘lanish

- Ilovada: Profil → Yordam markazi → «Yangi murojaat»
- Email: {{support_email}}
- Telefon: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Manzil: {{address}}
$terms_uz$,
  jsonb_build_object('en', 'Terms of Use'),
  jsonb_build_object('en', $terms_en$
These terms set out the rules for using the Jaxongirman mobile app and the jaxongirman.app website (the “Service”). By using the Service you agree to these terms and to the [Privacy Policy](/privacy?lang=en).

- Operator: {{company_name}}
- Taxpayer ID (STIR): {{stir}}

## 1. Your account

- You must be at least 13 years old to use the Service. If you are under 16, you need the consent of a parent or legal guardian.
- Give accurate information when you register. Your account is personal: do not share it and keep your sign-in details secret.
- You are responsible for what is done from your account. You can sign out an unknown device under Profile → Settings → Devices.
- The free starter allowance is given once per person. Opening several accounts to claim it again is not allowed.

## 2. What the Service offers

AI-assisted presentations, academic and independent papers, defense speeches and quiz questions; controlling a presentation from your phone; collecting data through surveys (the Data collection module); live knowledge games (O‘yingoh); and a marketplace where users list study materials. What the Service includes may change over time.

## 3. AI-generated content

- Text, questions and images are produced automatically and may contain errors, inaccuracies or outdated information.
- Check facts, figures, dates and sources yourself before using the result. AI output is not professional (legal, medical or financial) advice.
- Images placed on slides come from open sources (Unsplash, Wikimedia Commons and others) and are used under their own licences.
- Using the AI to create unlawful or discriminatory content, or content that infringes the rights of others, is prohibited.

## 4. Academic integrity

The Service is a tool to help you study and work. Following your institution’s rules is your responsibility: do not submit AI-assisted work as your own where the rules do not allow it, cite the sources you use, and check the text and complete it in your own words. The Service is not responsible for the consequences of breaking academic rules.

## 5. Your content

- Content you create and upload remains yours. You allow us to use it as needed to provide the Service (storing and processing it and showing it to the people you choose).
- Make sure you have the right to the material you upload.
- Prohibited: unlawful content, content inciting violence or hatred, pornography; publishing other people’s copyrighted works or personal data without their consent; malicious files.
- We may hide or remove content that breaks these terms.

## 6. J Tanga

- J Tanga is the Service’s internal unit of account, used to settle features inside the Service (for example presentation pages, games and documents). How many J Tanga an action costs is shown before you perform it.
- J Tanga is not money, electronic money or a means of payment: it cannot be exchanged for cash or withdrawn.
- J Tanga granted with a plan is valid for one month. If the plan is renewed before it ends, the remaining coins carry over to the next month; otherwise they expire.
- J Tanga granted with a plan cannot be transferred to another user. Other J Tanga can be transferred; a completed transfer cannot be reversed.
- If a presentation or other result cannot be produced, the J Tanga reserved for it are returned automatically.
- When an account is deleted, any remaining J Tanga balance is cancelled.

## 7. Marketplace

- Sellers are responsible for having the rights to what they list (files, presentations, games) and for describing it accurately.
- Products are moderated; a product that breaks the rules may be hidden or removed.
- The platform takes a commission on each sale; the seller’s share is calculated and paid out to them.
- Purchased materials may be used for personal and educational purposes. Reselling them or distributing them publicly is prohibited.
- Refund rules for digital products are on the [Refund Policy](/refund?lang=en) page.
- You can report a product that breaks the rules in the app.

## 8. O‘yingoh

- The host of a game is responsible for its content and for running it.
- Players’ nicknames and results are shown on the shared screen. Do not use offensive nicknames.
- A host may offer J Tanga rewards for the winners. The reward is reserved from the host’s balance when the game starts and paid to the winners at the end; if the game is cancelled or not finished, it is returned to the host.

## 9. Data collection (surveys)

- The survey creator is responsible for respondents’ data: ask only for what is needed, tell respondents why you are collecting it, and comply with the personal data legislation of the Republic of Uzbekistan.
- Responses are deleted automatically when the period set for the survey ends. The creator is responsible for any XLSX or CSV files downloaded before then: keep them secure and delete them when they are no longer needed.
- Surveys that are abusive, deceptive or unlawful may be closed.

## 10. Prohibited actions

- Attempting to break the Service, bypass its protections or access other users’ data.
- Flooding the Service with automated requests or scraping it.
- Circumventing limits and free allowances.
- Impersonating another person.

## 11. Limitation of liability

The Service is provided “as is”. We cannot guarantee that it will run without interruption or errors. To the extent permitted by law, we are not liable for errors in AI output, loss of data or indirect damages. Keep your own copies of important files.

## 12. Suspension and deletion

If these terms are broken, we may block the account temporarily or permanently. You can delete your account in the app at any time — see [Delete your account](/delete-account?lang=en).

## 13. Changes to these terms

These terms may change; the updated text is published on this page and the date below changes. Continuing to use the Service after a change means you accept the new terms.

## 14. Governing law

These terms are governed by the laws of the Republic of Uzbekistan. Disputes are first resolved through negotiation.

## 15. Contact

- In the app: Profile → Help center → “New request”
- Email: {{support_email}}
- Phone: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Address: {{address}}
$terms_en$),
  'published', 1, now()
),
(
  'support',
  'Yordam',
  $support_uz$
Savolingiz yoki muammongiz bo‘lsa, yordam beramiz.

## Ilova ichida murojaat qilish

Eng tez yo‘l — ilovaning o‘zi: **Profil → Yordam markazi → Yangi murojaat**. Mavzu turini tanlang, nima bo‘lganini yozing va kerak bo‘lsa skrinshot qo‘shing. Javobni yordam xizmati xodimi yozadi; javob kelganda ilovada bildirishnoma olasiz. Barcha yozishmalar «Mening murojaatlarim» bo‘limida saqlanadi.

## Boshqa aloqa yo‘llari

- Email: {{support_email}}
- Telefon: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Manzil: {{address}}

## Ko‘p beriladigan savollar

### Akkauntga kira olmayapman

Email bilan kirsangiz, emailingizga yuborilgan tasdiqlash havolasini ochganingizni tekshiring. Bitta email faqat bitta kirish usuliga bog‘lanadi: avval Apple yoki Google bilan kirgan bo‘lsangiz, o‘sha usul bilan kiring.

### Taqdimot yaratilmay qoldi. J Tanga qaytadimi?

Ha. Generatsiya xato bilan tugasa, band qilingan J Tanga va sahifalar avtomatik qaytariladi. Qaytmagan bo‘lsa, taqdimotni ko‘rsatib murojaat yuboring.

### Sun’iy intellekt yozgan matnda xato bor

AI natijasi xato yoki eskirgan bo‘lishi mumkin. Har bir slayd va matnni tahrirlash mumkin — topshirishdan oldin faktlarni tekshiring.

### O‘yingohga qanday qo‘shilaman?

Umumiy ekrandagi QR kodni telefon kamerasi bilan skanerlang yoki ilovaning O‘yingoh bo‘limida ekranda ko‘rsatilgan 6 xonali kodni kiriting.

### Akkauntim boshqa qurilmada ochiq qolib ketdi

Profil → Sozlamalar → Qurilmalar bo‘limida o‘sha qurilmani chiqarib yuboring.

### Akkauntimni qanday o‘chiraman?

Profil → Hisob → «Hisobni o‘chirish». Nima o‘chishi va nima qolishi [Akkauntni o‘chirish](/delete-account) sahifasida yozilgan.

### Ma’lumotlarim qanday himoyalanadi?

Qaysi ma’lumot nima uchun yig‘ilishi va kimga uzatilishi [Maxfiylik siyosati](/privacy)da yozilgan.
$support_uz$,
  jsonb_build_object('en', 'Support'),
  jsonb_build_object('en', $support_en$
If you have a question or a problem, we are here to help.

## Contact us in the app

The fastest way is the app itself: **Profile → Help center → New request**. Choose a topic, describe what happened and add screenshots if needed. A member of our support team writes the reply, and you get an in-app notification when it arrives. All conversations are kept under “My requests”.

## Other ways to reach us

- Email: {{support_email}}
- Phone: {{phone}}
- Telegram: [{{telegram}}]({{telegram_url}})
- Address: {{address}}

## Frequently asked questions

### I can’t sign in

If you use email, check that you have opened the confirmation link sent to your inbox. Each email address is tied to one sign-in method: if you first signed in with Apple or Google, use that method again.

### My presentation failed. Do I get my J Tanga back?

Yes. If generation ends with an error, the J Tanga and pages reserved for it are returned automatically. If they were not, send a request and mention the presentation.

### The AI text contains a mistake

AI output can be wrong or out of date. Every slide and text can be edited — check the facts before you hand anything in.

### How do I join an O‘yingoh game?

Scan the QR code on the shared screen with your phone camera, or enter the 6-digit code shown on the screen in the O‘yingoh section of the app.

### My account is still signed in on another device

Sign that device out under Profile → Settings → Devices.

### How do I delete my account?

Profile → Account → “Delete account”. What is deleted and what is kept is described on the [Delete your account](/delete-account?lang=en) page.

### How is my data protected?

The [Privacy Policy](/privacy?lang=en) explains what data is collected, why, and who it is shared with.
$support_en$),
  'published', 1, now()
),
(
  'delete-account',
  'Akkauntni o‘chirish',
  $delete_uz$
Jaxongirman akkauntingizni ilovaning o‘zida, istalgan vaqtda o‘chirishingiz mumkin. Buning uchun yordam xizmatiga yozish shart emas.

## Ilovada qanday o‘chiriladi

1. Jaxongirman ilovasini oching va akkauntingizga kiring.
2. Pastki menyuda **Profil**ni oching.
3. **Hisob** bo‘limida **Hisobni o‘chirish**ni bosing.
4. Ochilgan oynada «HISOBIMNI O‘CHIRAMAN» jumlasini yozing va **O‘CHIRISH** tugmasini bosing.

O‘chirish darhol bajariladi va uni ortga qaytarib bo‘lmaydi. Akkaunt kirilgan barcha qurilmalardan chiqariladi.

## Saytda

Ilova o‘rnatilmagan bo‘lsa va Apple yoki Google bilan ro‘yxatdan o‘tgan bo‘lsangiz, jaxongirman.app/kirish sahifasida shu usul bilan kiring va Profil → Hisob → «Hisobni o‘chirish»ni tanlang.

## Nima o‘chiriladi

- Profil: ism, familiya, foydalanuvchi nomi, bio, avatar, o‘qish yoki ish joyi.
- Taqdimotlar, slaydlar, yuklangan va eksport qilingan fayllar.
- Hujjatlar: obyektivka, ilmiy va mustaqil ishlar, himoya matnlari, 3×4 suratlar.
- O‘yinlar, savollar va o‘yinlardagi ishtirokingiz.
- Siz yaratgan so‘rovnomalar va ularning javoblari, boshqa so‘rovnomalarga bergan javoblaringiz.
- Yordam murojaatlari, bildirishnomalar, qurilmalar va sessiyalar.
- Saqlangan karta ko‘rinishlari va sotuvchi aloqa ma’lumotlari.
- J Tanga balansi.
- Kirish ma’lumotlari: email, parol va Apple yoki Google bilan bog‘lanish.

## Nima qoladi va nima uchun

Agar akkaunt orqali pul harakati bo‘lgan bo‘lsa — to‘lov qilgan, do‘konda sotgan yoki sotuvchi sifatida hisob-kitob qilingan bo‘lsangiz — quyidagi yozuvlar buxgalteriya va soliq hisobi uchun saqlanadi:

- buyurtmalar, to‘lov tranzaksiyalari va xaridlar;
- J Tanga harakatlari tarixi;
- tarif obunalari tarixi;
- sotuvchi hisob-kitoblari.

Bu yozuvlarda ismingiz, emailingiz yoki sizni aniqlaydigan boshqa ma’lumot qolmaydi — faqat ichki identifikator. Kirish ma’lumotlaringiz tiklab bo‘lmaydigan ko‘rinishga almashtiriladi va bu akkaunt bilan qayta kirib bo‘lmaydi. Pul harakati bo‘lmagan akkaunt butunlay o‘chiriladi.

Shuningdek:

- Do‘konda kimdir sotib olgan mahsulotingiz do‘kondan olinadi, lekin uni sotib olgan xaridorlarga ochiq qoladi. Bunday mahsulotga bog‘langan o‘yin ham arxivlanadi.
- Emailingizdan hisoblangan bir tomonlama xesh (emailning o‘zi emas) saqlanadi. U bir xil email bilan qayta ro‘yxatdan o‘tib, bepul boshlang‘ich imkoniyatni qayta olishning oldini oladi.

## Ilovaga kira olmasangiz

Akkauntga bog‘langan email manzilingizdan {{support_email}} ga «Akkauntni o‘chirish» mavzusida xat yozing. Akkaunt egasi ekaningizni tekshirib, so‘rovingizni bajaramiz.
$delete_uz$,
  jsonb_build_object('en', 'Delete your account'),
  jsonb_build_object('en', $delete_en$
You can delete your Jaxongirman account inside the app at any time. You do not need to contact support to do it.

## How to delete it in the app

1. Open the Jaxongirman app and sign in.
2. Open **Profile** in the bottom menu.
3. In the **Account** section, tap **Delete account**.
4. In the sheet that opens, type “DELETE MY ACCOUNT” and tap **DELETE**.

Deletion happens immediately and cannot be undone. The account is signed out on every device.

## On the website

If the app is not installed and you signed up with Apple or Google, sign in the same way at jaxongirman.app/kirish and choose Profile → Account → “Delete account”.

## What is deleted

- Your profile: name, username, bio, avatar, place of study or work.
- Presentations, slides, uploaded and exported files.
- Documents: obyektivka (CV form), academic and independent papers, defense speeches, 3×4 photos.
- Games, questions and your participation in games.
- Surveys you created and their responses, and your answers to other surveys.
- Support requests, notifications, devices and sessions.
- Saved (masked) card details and seller contact details.
- Your J Tanga balance.
- Sign-in details: email, password and the link to Apple or Google.

## What is kept, and why

If money moved through the account — you made a payment, sold something in the marketplace or received seller payouts — the following records are kept for accounting and tax purposes:

- orders, payment transactions and purchases;
- J Tanga transaction history;
- plan subscription history;
- seller settlements.

These records no longer contain your name, email or anything else that identifies you — only an internal identifier. Your sign-in details are replaced with an irreversible value, and the account can no longer be signed in to. An account with no money movement is deleted completely.

Also:

- A product of yours that someone has bought is taken off the marketplace but stays available to the buyers who paid for it. A game linked to such a product is archived as well.
- A one-way hash computed from your email (not the email itself) is kept. It prevents the free starter allowance from being claimed again by signing up with the same email.

## If you cannot sign in

Email {{support_email}} from the address linked to your account with the subject “Delete my account”. We will verify that you own the account and process the request.
$delete_en$),
  'published', 1, now()
),
(
  'refund',
  'Qaytarish siyosati',
  $refund_uz$
Bu sahifa Jaxongirman’dagi raqamli mahsulot va xizmatlar uchun qaytarish qoidalarini tushuntiradi.

{{refund_policy}}

## Avtomatik qaytarishlar

- Taqdimot yoki boshqa natija tayyorlanmay xato bilan tugasa, buning uchun band qilingan J Tanga va sahifalar avtomatik qaytariladi.
- O‘yingohda mukofot uchun band qilingan J Tanga o‘yin bekor qilinsa yoki tugamay qolsa, tashkilotchiga qaytariladi.

## Qaytarilmaydigan holatlar

- Foydalanuvchilar o‘rtasidagi J Tanga o‘tkazmalari bekor qilinmaydi.
- Natija tayyor bo‘lgach, unga sarflangan J Tanga qaytarilmaydi.
- Tarif bilan berilgan J Tanga tarif yangilanmasa oy oxirida kuyadi — [Foydalanish shartlari](/terms)ga qarang.

## Muammo bo‘lsa

Mahsulot tavsifiga mos kelmasa, fayl ochilmasa yoki to‘lov bo‘yicha savolingiz bo‘lsa, ilovada Profil → Yordam markazi → «Yangi murojaat» orqali buyurtma raqamini ko‘rsatib yozing. Har bir murojaat alohida ko‘rib chiqiladi.

- Email: {{support_email}}
$refund_uz$,
  jsonb_build_object('en', 'Refund Policy'),
  jsonb_build_object('en', $refund_en$
This page explains the refund rules for digital products and services on Jaxongirman.

{{refund_policy}}

## Automatic returns

- If a presentation or other result fails with an error, the J Tanga and pages reserved for it are returned automatically.
- J Tanga reserved for O‘yingoh rewards are returned to the host if the game is cancelled or not finished.

## What is not refunded

- J Tanga transfers between users cannot be reversed.
- Once a result has been produced, the J Tanga spent on it are not returned.
- J Tanga granted with a plan expire at the end of the month if the plan is not renewed — see the [Terms of Use](/terms?lang=en).

## If something is wrong

If a product does not match its description, a file does not open, or you have a question about a payment, write to us in the app via Profile → Help center → “New request” and include the order number. Every request is reviewed individually.

- Email: {{support_email}}
$refund_en$),
  'published', 1, now()
)
on conflict (slug) do nothing;

-- The leading and trailing blank lines are the dollar quotes', not the text's.
update public.site_pages
   set body = btrim(body, E'\n'),
       body_i18n = (select coalesce(jsonb_object_agg(key, btrim(value, E'\n')), '{}'::jsonb) from jsonb_each_text(body_i18n))
 where version = 1;

insert into public.site_page_versions (slug, version, title, body, title_i18n, body_i18n, published_at, reason)
select slug, version, title, body, title_i18n, body_i18n, published_at, 'Boshlang‘ich matn (202610200002_site_pages)'
  from public.site_pages
 where version = 1
on conflict (slug, version) do nothing;
