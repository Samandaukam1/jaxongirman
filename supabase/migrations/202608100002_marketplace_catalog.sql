-- The marketplace catalogue: what is for sale, who is selling it, and what
-- state it is in. Money, payment and entitlement live in the migration after
-- this one; nothing here moves a som.
--
-- Three decisions shape the schema:
--
--   1. Material types are rows, not an enum. "Diplom ishi" and "kurs ishi" are
--      coming, and adding one should be an insert an admin performs, not a
--      migration a developer writes. The type row also carries what may be
--      uploaded for it, so the file rules travel with the type.
--
--   2. Nothing is readable by `anon`. The catalogue is an in-app service; the
--      public website shows an install prompt rather than the products. Covers
--      and previews are private objects too, signed in batches per screen.
--
--   3. An approved product that is edited goes back into review. Otherwise
--      approval means "this seller was once trustworthy" rather than "a human
--      looked at exactly these bytes".

-- Trigram search, for the prefix matching a shopper actually types. Full-text
-- alone only matches whole lexemes.
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------------ material types --
/**
 * What may be sold, and the upload rules that come with it. Extensible by
 * insert: a new material type needs no code change on either client.
 */
create table public.marketplace_material_types (
  code text primary key,
  label text not null,
  description text not null default '',
  -- The server validates the uploaded file's sniffed type against this list.
  -- An extension check alone is not a control.
  allowed_mime_types text[] not null,
  max_file_bytes integer not null default 52428800,
  /** Whether a seller may attach a separate reading companion to this type. */
  supports_study_guide boolean not null default false,
  /** Whether the main file can be opened in the Jaxongirman editor after purchase. */
  supports_editor_import boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_material_types_code_format check (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  constraint marketplace_material_types_label_length check (char_length(btrim(label)) between 1 and 80),
  constraint marketplace_material_types_mimes check (array_length(allowed_mime_types, 1) >= 1),
  constraint marketplace_material_types_size check (max_file_bytes between 1024 and 524288000)
);

create trigger marketplace_material_types_set_updated_at
  before update on public.marketplace_material_types
  for each row execute function public.set_updated_at();

insert into public.marketplace_material_types (
  code, label, description, allowed_mime_types, max_file_bytes,
  supports_study_guide, supports_editor_import, sort_order
) values
  (
    'presentation', 'Taqdimot', 'PowerPoint taqdimoti — xarid qilgach Jaxongirman muharririda ochiladi',
    array['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    52428800, true, true, 10
  ),
  (
    'independent_work', 'Mustaqil ish', 'Mustaqil ish matni',
    array['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
    26214400, true, false, 20
  ),
  (
    'essay', 'Referat', 'Referat matni',
    array['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
    26214400, true, false, 30
  )
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  allowed_mime_types = excluded.allowed_mime_types,
  max_file_bytes = excluded.max_file_bytes,
  supports_study_guide = excluded.supports_study_guide,
  supports_editor_import = excluded.supports_editor_import,
  sort_order = excluded.sort_order;

-- --------------------------------------------------------------- categories --
create table public.marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  -- One level of nesting is enough for a subject tree and keeps every query a
  -- single join rather than a recursion.
  parent_id uuid references public.marketplace_categories(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_categories_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint marketplace_categories_label_length check (char_length(btrim(label)) between 1 and 80)
);

create index marketplace_categories_parent_idx on public.marketplace_categories (parent_id, sort_order) where is_active;

create trigger marketplace_categories_set_updated_at
  before update on public.marketplace_categories
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- products --
create type public.marketplace_product_status as enum (
  'draft', 'pending_review', 'approved', 'rejected', 'hidden', 'archived'
);

/**
 * One listing. Sold one-to-many: a purchase never decrements anything here, so
 * there is deliberately no inventory column to go wrong.
 *
 * `base_price` is what the seller set, in whole som. Both commissions are
 * derived from it at checkout and snapshotted onto the purchase — this row is
 * never the source of a historical figure.
 */
create table public.marketplace_products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  material_type text not null references public.marketplace_material_types(code),
  category_id uuid references public.marketplace_categories(id) on delete set null,
  title text not null,
  description text not null default '',
  status public.marketplace_product_status not null default 'draft',
  -- Whole som. Never a float: 0.1 + 0.2 must not be able to happen to money.
  base_price integer not null,
  currency text not null default 'UZS',
  cover_path text,
  /** Slides for a deck, pages for a document. One column, named for neither. */
  content_units integer,
  file_format text,
  has_study_guide boolean not null default false,
  -- Denormalised counters, maintained by trigger from the rows that own the
  -- truth, so a listing grid needs no aggregate subquery.
  sales_count integer not null default 0,
  rating_sum integer not null default 0,
  rating_count integer not null default 0,
  published_at timestamptz,
  rejection_reason text,
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  -- 'simple' rather than a language config: Postgres ships no Uzbek stemmer, and
  -- a wrong stemmer is worse than none. Trigram indexes below cover partial words.
  search_text tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_products_title_length check (char_length(btrim(title)) between 3 and 160),
  constraint marketplace_products_description_length check (char_length(description) <= 4000),
  constraint marketplace_products_price check (base_price >= 0 and base_price <= 1000000000),
  constraint marketplace_products_currency check (currency ~ '^[A-Z]{3}$'),
  constraint marketplace_products_units check (content_units is null or content_units between 1 and 100000),
  constraint marketplace_products_counters check (sales_count >= 0 and rating_count >= 0 and rating_sum >= 0),
  constraint marketplace_products_rejection check (
    status <> 'rejected'::public.marketplace_product_status or nullif(btrim(coalesce(rejection_reason, '')), '') is not null
  )
);

-- The listing grid: approved products, newest first, optionally by category or
-- type. One partial index serves the whole public catalogue.
create index marketplace_products_live_idx
  on public.marketplace_products (published_at desc, id)
  where status = 'approved'::public.marketplace_product_status;
create index marketplace_products_live_category_idx
  on public.marketplace_products (category_id, published_at desc)
  where status = 'approved'::public.marketplace_product_status;
create index marketplace_products_live_type_idx
  on public.marketplace_products (material_type, published_at desc)
  where status = 'approved'::public.marketplace_product_status;
create index marketplace_products_live_price_idx
  on public.marketplace_products (base_price)
  where status = 'approved'::public.marketplace_product_status;
create index marketplace_products_popular_idx
  on public.marketplace_products (sales_count desc)
  where status = 'approved'::public.marketplace_product_status;
-- The seller's own shelf, and the moderation queue.
create index marketplace_products_seller_idx on public.marketplace_products (seller_id, created_at desc);
create index marketplace_products_moderation_idx
  on public.marketplace_products (created_at)
  where status = 'pending_review'::public.marketplace_product_status;
create index marketplace_products_search_idx on public.marketplace_products using gin (search_text);
-- Trigram, so "prezent" finds "Prezentatsiya" — full-text alone matches whole
-- lexemes and a shopper types prefixes.
create index marketplace_products_title_trgm_idx on public.marketplace_products using gin (title extensions.gin_trgm_ops);

create trigger marketplace_products_set_updated_at
  before update on public.marketplace_products
  for each row execute function public.set_updated_at();

/**
 * Approval covers the bytes that were approved, not the seller.
 *
 * Editing anything a buyer decides on — the title, the description, the price,
 * the files, the type — sends an approved listing back to the queue. Status
 * changes made by the moderation RPC are exempt: that path sets the status
 * deliberately and must not be undone by this trigger.
 */
create or replace function public.marketplace_reopen_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved'::public.marketplace_product_status
     and new.status = old.status
     and (
       new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.base_price is distinct from old.base_price
       or new.material_type is distinct from old.material_type
       or new.category_id is distinct from old.category_id
       or new.cover_path is distinct from old.cover_path
       or new.has_study_guide is distinct from old.has_study_guide
     )
  then
    new.status := 'pending_review'::public.marketplace_product_status;
    new.published_at := null;
    new.moderated_by := null;
    new.moderated_at := null;
  end if;
  return new;
end;
$$;

create trigger marketplace_products_reopen_review
  before update on public.marketplace_products
  for each row execute function public.marketplace_reopen_review();

-- -------------------------------------------------------------------- files --
create type public.marketplace_file_kind as enum ('main', 'study_guide', 'preview');

/**
 * Every object a listing owns. The main file and the study guide are what a
 * buyer pays for and are never handed out without an entitlement check;
 * previews are marketing and are signed for anyone who can see the listing.
 */
create table public.marketplace_product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  kind public.marketplace_file_kind not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  original_name text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint marketplace_product_files_size check (size_bytes > 0 and size_bytes <= 524288000),
  constraint marketplace_product_files_path check (char_length(storage_path) between 3 and 500)
);

-- Exactly one sellable file and at most one companion; previews may repeat.
create unique index marketplace_product_files_main_idx
  on public.marketplace_product_files (product_id)
  where kind = 'main'::public.marketplace_file_kind;
create unique index marketplace_product_files_guide_idx
  on public.marketplace_product_files (product_id)
  where kind = 'study_guide'::public.marketplace_file_kind;
create index marketplace_product_files_product_idx on public.marketplace_product_files (product_id, kind, position);

-- --------------------------------------------------------------------- tags --
create table public.marketplace_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint marketplace_tags_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint marketplace_tags_label_length check (char_length(btrim(label)) between 1 and 60)
);

create table public.marketplace_product_tags (
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  tag_id uuid not null references public.marketplace_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create index marketplace_product_tags_tag_idx on public.marketplace_product_tags (tag_id);

-- ---------------------------------------------------------------- favorites --
create table public.marketplace_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index marketplace_favorites_product_idx on public.marketplace_favorites (product_id);

-- ------------------------------------------------------------------ reports --
create type public.marketplace_report_reason as enum (
  'copyright', 'plagiarism', 'inappropriate', 'fraud', 'other'
);
create type public.marketplace_report_status as enum ('open', 'reviewing', 'upheld', 'dismissed');

create table public.marketplace_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.marketplace_products(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason public.marketplace_report_reason not null,
  detail text not null default '',
  status public.marketplace_report_status not null default 'open',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text not null default '',
  created_at timestamptz not null default now(),
  -- One open complaint per person per listing; a second is the same complaint.
  unique (product_id, reporter_id),
  constraint marketplace_reports_detail_length check (char_length(detail) <= 1000),
  constraint marketplace_reports_note_length check (char_length(resolution_note) <= 1000)
);

create index marketplace_reports_queue_idx
  on public.marketplace_reports (created_at)
  where status in ('open'::public.marketplace_report_status, 'reviewing'::public.marketplace_report_status);
create index marketplace_reports_product_idx on public.marketplace_reports (product_id);

-- ---------------------------------------------------------------------- RLS --
alter table public.marketplace_material_types enable row level security;
alter table public.marketplace_categories enable row level security;
alter table public.marketplace_products enable row level security;
alter table public.marketplace_product_files enable row level security;
alter table public.marketplace_tags enable row level security;
alter table public.marketplace_product_tags enable row level security;
alter table public.marketplace_favorites enable row level security;
alter table public.marketplace_reports enable row level security;

/** True when this listing is visible to the caller at all. */
create or replace function public.marketplace_can_see_product(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_products p
    where p.id = p_product_id
      and (
        p.status = 'approved'::public.marketplace_product_status
        or p.seller_id = p_user_id
        or public.is_admin(p_user_id)
      )
  );
$$;

/** True when the caller owns the listing. Used by every seller-side policy. */
create or replace function public.marketplace_is_seller(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_products p where p.id = p_product_id and p.seller_id = p_user_id
  );
$$;

-- Reference data: readable by anyone signed in, written only by admin RPCs.
create policy marketplace_material_types_select on public.marketplace_material_types for select to authenticated
  using (is_active or (select public.is_admin()));
create policy marketplace_categories_select on public.marketplace_categories for select to authenticated
  using (is_active or (select public.is_admin()));
create policy marketplace_tags_select on public.marketplace_tags for select to authenticated using (true);

-- A listing is visible once approved; before that only its seller and an admin
-- can see it. There is no `anon` clause anywhere in this file.
create policy marketplace_products_select on public.marketplace_products for select to authenticated
  using (
    status = 'approved'::public.marketplace_product_status
    or seller_id = (select auth.uid())
    or (select public.is_admin())
  );
-- A seller may create a listing, but not publish one: `approved` is reachable
-- only through the moderation RPC, which runs as the definer.
create policy marketplace_products_insert on public.marketplace_products for insert to authenticated
  with check (
    seller_id = (select auth.uid())
    and status in ('draft'::public.marketplace_product_status, 'pending_review'::public.marketplace_product_status)
  );
create policy marketplace_products_update on public.marketplace_products for update to authenticated
  using (seller_id = (select auth.uid()))
  with check (
    seller_id = (select auth.uid())
    and status <> 'approved'::public.marketplace_product_status
  );
-- Only an unsold draft can be removed outright; anything else is archived, so
-- a buyer's library never loses the row behind their purchase.
create policy marketplace_products_delete on public.marketplace_products for delete to authenticated
  using (
    seller_id = (select auth.uid())
    and sales_count = 0
    and status in ('draft'::public.marketplace_product_status, 'rejected'::public.marketplace_product_status)
  );

-- File rows carry storage paths. Buyers never read them: a download goes
-- through the entitlement-checked signing RPC, which runs as the definer.
create policy marketplace_product_files_select on public.marketplace_product_files for select to authenticated
  using (public.marketplace_is_seller(product_id) or (select public.is_admin()));
create policy marketplace_product_files_write on public.marketplace_product_files for all to authenticated
  using (public.marketplace_is_seller(product_id))
  with check (public.marketplace_is_seller(product_id));

create policy marketplace_product_tags_select on public.marketplace_product_tags for select to authenticated
  using (public.marketplace_can_see_product(product_id));
create policy marketplace_product_tags_write on public.marketplace_product_tags for all to authenticated
  using (public.marketplace_is_seller(product_id))
  with check (public.marketplace_is_seller(product_id));

create policy marketplace_favorites_all on public.marketplace_favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.marketplace_can_see_product(product_id));

-- A reporter sees their own complaint and its outcome; nobody else does, so a
-- seller cannot work out who reported them.
create policy marketplace_reports_select on public.marketplace_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));
create policy marketplace_reports_insert on public.marketplace_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and public.marketplace_can_see_product(product_id));

-- Table privileges are granted explicitly in this schema; RLS alone would leave
-- every table above unreadable.
grant select on
  public.marketplace_material_types, public.marketplace_categories, public.marketplace_tags,
  public.marketplace_products, public.marketplace_product_files, public.marketplace_product_tags,
  public.marketplace_favorites, public.marketplace_reports
to authenticated;
grant insert, update, delete on public.marketplace_products to authenticated;
grant insert, update, delete on public.marketplace_product_files, public.marketplace_product_tags to authenticated;
grant insert, delete on public.marketplace_favorites to authenticated;
grant insert on public.marketplace_reports to authenticated;

-- The server reads the catalogue when it signs a download or builds an export.
grant select on
  public.marketplace_material_types, public.marketplace_categories, public.marketplace_tags,
  public.marketplace_products, public.marketplace_product_files, public.marketplace_product_tags,
  public.marketplace_favorites, public.marketplace_reports
to service_role;

-- Hosted Supabase grants table privileges to anon through default privileges,
-- which `grant ... to authenticated` does not take away. The catalogue is an
-- in-app service: signed out, it must be unreachable rather than merely empty.
revoke all on
  public.marketplace_material_types, public.marketplace_categories, public.marketplace_tags,
  public.marketplace_products, public.marketplace_product_files, public.marketplace_product_tags,
  public.marketplace_favorites, public.marketplace_reports
from anon;

-- ------------------------------------------------------------------ storage --
-- Both buckets are private. Covers and previews are marketing images, but the
-- catalogue itself is app-only, so even those are signed per screen rather than
-- served from a public URL. Source files are never signed without a purchase.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('marketplace-previews', 'marketplace-previews', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('marketplace-files', 'marketplace-files', false, 524288000, array[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path shape is <seller_id>/<product_id>/<file>. The first segment is who may
-- write; reading a source file is not a storage policy at all, because no
-- client role is ever granted it — the signing RPC uses the service role.
create policy marketplace_previews_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'marketplace-previews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy marketplace_previews_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'marketplace-previews' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'marketplace-previews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy marketplace_previews_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marketplace-previews' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Previews are visible to anyone who can see the listing they belong to.
create policy marketplace_previews_select on storage.objects for select to authenticated
  using (
    bucket_id = 'marketplace-previews'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.marketplace_can_see_product(nullif((storage.foldername(name))[2], '')::uuid)
    )
  );

create policy marketplace_files_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'marketplace-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy marketplace_files_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'marketplace-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'marketplace-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy marketplace_files_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marketplace-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Deliberately no SELECT policy for `authenticated` on marketplace-files: the
-- only way to read a sellable file is a signed URL minted server-side after an
-- entitlement check. A seller reaches their own upload through the same path.

-- ----------------------------------------------------------------- grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.marketplace_can_see_product(uuid, uuid)',
    'public.marketplace_is_seller(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
