/**
 * "Jaxongirman tavsiya qiladi" — recommendations and advertising on Bosh sahifa.
 *
 * One table for both, because a person sees them in one place: a carousel of
 * wide banners under the account card. `kind` says which one a row is, and an
 * advertisement is always labelled as one in the app ("Reklama" and the
 * advertiser's name) — paid placement is never dressed up as a recommendation.
 *
 * A row is a banner (16:6, picture or silent video) and what tapping it does:
 * open an external link, or open an article written in the admin console. The
 * article is `body`, an ordered list of blocks — headings, formatted text,
 * quotes, pictures, video, audio, buttons — validated by the console and drawn
 * by the app; the database only insists that it is a list. The article's own
 * hero picture (or video) sits at the top of its page.
 *
 * Only administrators write. Everybody signed in reads what is published and
 * inside its dates; views and taps are counted through `promo_track`, which
 * is the only way a non-admin touches a row.
 */

create table if not exists public.promos (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'recommendation' check (kind in ('recommendation', 'ad')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  subtitle text not null default '' check (char_length(subtitle) <= 280),
  -- Who paid for an advertisement. Shown next to the "Reklama" label.
  sponsor text not null default '' check (char_length(sponsor) <= 80),
  -- The small label on the banner. null: the default for the kind ("Reklama"
  -- on an advertisement, nothing on a recommendation). '': no label at all.
  -- Anything else: that text ("Yangi", "Aksiya", "Hamkor").
  badge text check (badge is null or char_length(badge) <= 24),
  banner_url text check (banner_url is null or banner_url ~* '^https?://'),
  banner_kind text not null default 'image' check (banner_kind in ('image', 'video')),
  -- 'overlay': the title, subtitle, shade and arrow are drawn over the banner.
  -- 'image': the picture alone — for artwork that already carries its words.
  banner_style text not null default 'overlay' check (banner_style in ('overlay', 'image')),
  hero_url text check (hero_url is null or hero_url ~* '^https?://'),
  hero_kind text not null default 'image' check (hero_kind in ('image', 'video')),
  action text not null default 'article' check (action in ('article', 'link')),
  link_url text check (link_url is null or link_url ~* '^https?://'),
  body jsonb not null default '[]'::jsonb check (jsonb_typeof(body) = 'array'),
  -- How the article is set: its typeface and accent colour.
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object'),
  position integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  view_count bigint not null default 0,
  click_count bigint not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promos_link_needs_url check (action <> 'link' or link_url is not null),
  constraint promos_dates_in_order check (starts_at is null or ends_at is null or starts_at < ends_at)
);

create index if not exists promos_live on public.promos (status, position, created_at desc);

alter table public.promos enable row level security;

drop policy if exists promos_read on public.promos;
create policy promos_read on public.promos
  for select to authenticated
  using (
    (status = 'published'
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now()))
    or (select public.is_admin())
  );

drop policy if exists promos_admin_insert on public.promos;
create policy promos_admin_insert on public.promos
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists promos_admin_update on public.promos;
create policy promos_admin_update on public.promos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists promos_admin_delete on public.promos;
create policy promos_admin_delete on public.promos
  for delete to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.promos to authenticated;
grant all on public.promos to service_role;

/**
 * A view or a tap, counted.
 *
 * Security definer because the counters live on a row nobody but an admin may
 * update. It only ever adds one, only to a live row, and answers nothing.
 */
create or replace function public.promo_track(p_promo_id uuid, p_event text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.promos
     set view_count = view_count + case when p_event = 'view' then 1 else 0 end,
         click_count = click_count + case when p_event = 'click' then 1 else 0 end
   where id = p_promo_id
     and status = 'published'
     and p_event in ('view', 'click')
     and auth.uid() is not null;
$$;

revoke all on function public.promo_track(uuid, text) from public;
grant execute on function public.promo_track(uuid, text) to authenticated;

/**
 * Banner pictures, hero videos, and the pictures, video and audio inside an
 * article.
 *
 * Public, like `marathon-posters`: everything here is shown to everybody who
 * opens the app, and signing a URL for it would cost a round trip and protect
 * nothing. Writing is for administrators only.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'promo-media', 'promo-media', true, 52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/ogg'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists promo_media_read on storage.objects;
create policy promo_media_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'promo-media');

drop policy if exists promo_media_write on storage.objects;
create policy promo_media_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'promo-media' and (select public.is_admin()));

drop policy if exists promo_media_replace on storage.objects;
create policy promo_media_replace on storage.objects
  for update to authenticated
  using (bucket_id = 'promo-media' and (select public.is_admin()))
  with check (bucket_id = 'promo-media' and (select public.is_admin()));

drop policy if exists promo_media_remove on storage.objects;
create policy promo_media_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'promo-media' and (select public.is_admin()));
