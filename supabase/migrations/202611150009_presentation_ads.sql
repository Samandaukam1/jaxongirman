-- Ads when a deck is presented (jaxongirman.app/taqdimot) and downloaded.
--
-- Two kinds, decided by the presenter's plan:
-- * Ad pages — only for an owner with no active plan. Up to three, set in the
--   console. After every fifth page of the deck one ad page is placed (page 6,
--   12, 18 …), each ad once, and only where more of the deck follows — so a
--   deck never ends on an ad and never shows more ad pages than there are ads.
--   They are pages: the phone counts them, the screen shows them, the
--   downloaded file contains them. A plan bought removes them at once.
--   Counted only for a phone that asks (`p_with_ads`): an app from before
--   2.0 steps through slides only, so its talk has no ad pages — otherwise
--   its preview and the screen part ways at page 6.
-- * A banner (7:1) that slides down from the top for about fifteen seconds now
--   and then — for an owner with no plan and for the cheapest plan.

create table if not exists public.presentation_ads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('slide', 'banner')),
  image_path text not null check (char_length(image_path) between 3 and 300),
  link_url text check (link_url is null or (link_url ~ '^https://\S+$' and char_length(link_url) <= 500)),
  position integer not null default 0 check (position between 0 and 99),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.presentation_ads is
  'Ads shown with presented and downloaded decks: slide (a full ad page, at most 3 active) or banner (7:1, slides down from the top).';

alter table public.presentation_ads enable row level security;
drop policy if exists presentation_ads_admin_read on public.presentation_ads;
create policy presentation_ads_admin_read on public.presentation_ads for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete on public.presentation_ads from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('presentation-ads', 'presentation-ads', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists presentation_ads_media_read on storage.objects;
create policy presentation_ads_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'presentation-ads');
drop policy if exists presentation_ads_media_write on storage.objects;
create policy presentation_ads_media_write on storage.objects
  for insert to authenticated with check (bucket_id = 'presentation-ads' and (select public.is_admin()));
drop policy if exists presentation_ads_media_replace on storage.objects;
create policy presentation_ads_media_replace on storage.objects
  for update to authenticated
  using (bucket_id = 'presentation-ads' and (select public.is_admin()))
  with check (bucket_id = 'presentation-ads' and (select public.is_admin()));
drop policy if exists presentation_ads_media_remove on storage.objects;
create policy presentation_ads_media_remove on storage.objects
  for delete to authenticated using (bucket_id = 'presentation-ads' and (select public.is_admin()));

/** How many ad pages a deck of p_pages gets from p_ads ads: one after each fifth page that more of the deck follows. */
create or replace function public.presentation_ad_pages(p_pages integer, p_ads integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_ads, 0), 0), greatest((coalesce(p_pages, 0) - 1) / 5, 0));
$$;

/**
 * What an owner's decks show: ad pages and banners by plan, with the banner's
 * timing. Readable by the owner themselves, an admin, or the server.
 */
create or replace function public.presentation_ads_for(p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_price integer;
  v_cheapest integer;
  v_slides boolean;
  v_banners boolean;
  v_timing jsonb := coalesce((select value from public.app_settings where key = 'presentation.ads'), '{}'::jsonb);
begin
  if v_caller is not null and v_caller is distinct from p_owner and not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select p.price_amount into v_price
    from public.user_subscriptions s join public.subscription_plans p on p.id = s.plan_id
   where s.user_id = p_owner and s.status = 'active' and s.expires_at > now()
   order by p.price_amount desc limit 1;
  select min(price_amount) into v_cheapest from public.subscription_plans where is_active and price_amount > 0;

  v_slides := v_price is null;
  v_banners := v_price is null or (v_cheapest is not null and v_price <= v_cheapest);

  return jsonb_build_object(
    'slides', case when v_slides then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.image_path, 'link', a.link_url) order by a.position, a.created_at)
        from (select * from public.presentation_ads where kind = 'slide' and active order by position, created_at limit 3) a
    ), '[]'::jsonb) else '[]'::jsonb end,
    'banners', case when v_banners then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.image_path, 'link', a.link_url) order by a.position, a.created_at)
        from public.presentation_ads a where a.kind = 'banner' and a.active
    ), '[]'::jsonb) else '[]'::jsonb end,
    'banner', jsonb_build_object(
      'first_seconds', coalesce((v_timing ->> 'banner_first_seconds')::integer, 30),
      'every_seconds', coalesce((v_timing ->> 'banner_every_seconds')::integer, 240),
      'show_seconds', coalesce((v_timing ->> 'banner_show_seconds')::integer, 15)
    )
  );
end;
$$;

revoke all on function public.presentation_ads_for(uuid) from public, anon;
grant execute on function public.presentation_ads_for(uuid) to authenticated, service_role;

/** The console's door: save one ad. At most three active ad pages at a time. */
create or replace function public.admin_save_presentation_ad(
  p_id uuid, p_kind text, p_image_path text, p_link_url text default null,
  p_position integer default 0, p_active boolean default true, p_reason text default ''
)
returns public.presentation_ads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.presentation_ads%rowtype;
  v_row public.presentation_ads%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind = 'slide' and coalesce(p_active, true) and (
    select count(*) from public.presentation_ads where kind = 'slide' and active and id is distinct from p_id
  ) >= 3 then
    raise exception 'Bir vaqtda ko‘pi bilan 3 ta reklama sahifasi faol bo‘la oladi.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.presentation_ads (kind, image_path, link_url, position, active, updated_by)
    values (p_kind, btrim(p_image_path), nullif(btrim(coalesce(p_link_url, '')), ''), coalesce(p_position, 0), coalesce(p_active, true), v_admin)
    returning * into v_row;
  else
    select * into v_before from public.presentation_ads where id = p_id for update;
    if not found then raise exception 'ad not found' using errcode = 'P0002'; end if;
    update public.presentation_ads set
      kind = p_kind, image_path = btrim(p_image_path), link_url = nullif(btrim(coalesce(p_link_url, '')), ''),
      position = coalesce(p_position, 0), active = coalesce(p_active, true), updated_at = now(), updated_by = v_admin
     where id = p_id returning * into v_row;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'presentation_ad.saved', 'presentation_ad', v_row.id::text,
          case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_row), nullif(btrim(coalesce(p_reason, '')), ''));
  return v_row;
end;
$$;

create or replace function public.admin_delete_presentation_ad(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.presentation_ads%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  delete from public.presentation_ads where id = p_id returning * into v_before;
  if v_before.id is null then raise exception 'ad not found' using errcode = 'P0002'; end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (auth.uid(), 'presentation_ad.deleted', 'presentation_ad', p_id::text, to_jsonb(v_before), null, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function public.admin_save_presentation_ad(uuid, text, text, text, integer, boolean, text) from public, anon;
grant execute on function public.admin_save_presentation_ad(uuid, text, text, text, integer, boolean, text) to authenticated, service_role;
revoke all on function public.admin_delete_presentation_ad(uuid, text) from public, anon;
grant execute on function public.admin_delete_presentation_ad(uuid, text) to authenticated, service_role;

insert into public.app_settings (key, value, description, public_read)
values ('presentation.ads', '{"banner_first_seconds": 30, "banner_every_seconds": 240, "banner_show_seconds": 15}'::jsonb,
  'When the presenting banner comes down: after first_seconds, then every every_seconds, for show_seconds.', false)
on conflict (key) do nothing;

/**
 * Choosing a deck counts its ad pages too — when the phone places them. Only
 * an app that knows ad pages (2.0 on) sends `p_with_ads`; an older one gets a
 * count of slides, and the screen, which places as many ad pages as the count
 * leaves room for, then shows none. Dropped and recreated: a defaulted extra
 * argument is a new signature, and two would make the old call ambiguous.
 */
drop function if exists public.presentation_session_set_deck(uuid, uuid);

create or replace function public.presentation_session_set_deck(
  p_session_id uuid,
  p_presentation_id uuid,
  p_with_ads boolean default false
)
returns public.presentation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.presentation_sessions%rowtype;
  v_slides integer;
begin
  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_user is null or v_session.host_user_id is distinct from v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;

  select count(*) into v_slides
  from public.slides s
  join public.presentations p on p.id = s.presentation_id
  where s.presentation_id = p_presentation_id
    and p.owner_id = v_user
    and p.status = 'ready'::public.presentation_status;
  if v_slides = 0 then
    raise exception 'Taqdimot topilmadi yoki sizga tegishli emas.' using errcode = '42501';
  end if;

  -- A free owner's deck carries ad pages: they are pages like any other, on
  -- the phone and on the screen, so they are counted here — for a phone that
  -- shows them.
  if coalesce(p_with_ads, false) then
    v_slides := v_slides + public.presentation_ad_pages(v_slides,
      jsonb_array_length(public.presentation_ads_for(v_user) -> 'slides'));
  end if;

  update public.presentation_sessions
  set
    presentation_id = p_presentation_id,
    slide_count = v_slides,
    current_slide = 0,
    zoom = 1,
    translate_x = 0,
    translate_y = 0,
    deck_revision = deck_revision + 1,
    state_version = state_version + 1,
    last_command_at = now()
  where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.presentation_session_set_deck(uuid, uuid, boolean) from public, anon;
grant execute on function public.presentation_session_set_deck(uuid, uuid, boolean) to authenticated, service_role;
