-- Free listings, and every new O‘yingoh game in the store an hour after it is made.
--
-- * Free listings: a product priced 0 is not bought — it is taken. Taking it
--   writes an entitlement of its own kind (source 'free', no purchase behind
--   it); payments, purchases and the seller ledger are not touched, so no
--   report ever sees a "0 so‘m sale". `marketplace_claim_free` is the one door.
-- * Auto-publish (the 2.0 spec, for everyone): a game made from now on is put in
--   the store, free, one hour after it was created — unless its owner stops it
--   or lists it themselves (with a price). The owner is told at once and can do
--   either from the notification. Games made before this migration are left
--   exactly where they are.
-- * Auto-publish waits behind a switch, `games.store_autopublish`, shipped
--   off. The apps in the stores before 2.0 can neither see nor stop nor price
--   an auto-published game (and open a route they do not have from its
--   notice), and the public offer must carry the clause first. Turn it on
--   once both hold:
--     update public.app_settings set value = '{"enabled": true}'
--      where key = 'games.store_autopublish';
-- * A free listing is never bought. Those same older apps know only "Sotib
--   olish" and would open a 0 so‘m order and a card payment for it; a
--   trigger on orders and payments refuses that, whichever path opens it.

-- The two notices auto-publish sends. Added outside any use in this file: a new
-- enum value cannot be used in the transaction that adds it, and here it is only
-- named inside function bodies, which run later.
alter type public.notification_kind add value if not exists 'game_store_autopublish';
alter type public.notification_kind add value if not exists 'game_store_published';

-- ------------------------------------------------------------ free claims --
alter table public.purchase_entitlements
  add column if not exists source text not null default 'purchase';
alter table public.purchase_entitlements alter column purchase_id drop not null;
alter table public.purchase_entitlements drop constraint if exists purchase_entitlements_source;
alter table public.purchase_entitlements add constraint purchase_entitlements_source
  check (source in ('purchase', 'free') and ((source = 'purchase') = (purchase_id is not null)));

comment on column public.purchase_entitlements.source is
  'purchase: bought (purchase_id set); free: taken from a free listing (no purchase).';

/** Takes a free listing: an entitlement, nothing paid, nothing recorded as a sale. */
create or replace function public.marketplace_claim_free(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found or v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot topilmadi.' using errcode = 'P0002';
  end if;
  if v_product.base_price <> 0 then
    raise exception 'Bu mahsulot tekin emas.' using errcode = '22023';
  end if;
  if v_product.seller_id = v_user then
    return jsonb_build_object('product_id', v_product.id, 'granted', true, 'own', true);
  end if;

  insert into public.purchase_entitlements (purchase_id, user_id, product_id, source)
  values (null, v_user, v_product.id, 'free')
  on conflict (user_id, product_id) do update set revoked_at = null
    where public.purchase_entitlements.source = 'free';

  return jsonb_build_object('product_id', v_product.id, 'granted', true, 'own', false);
end;
$$;

revoke all on function public.marketplace_claim_free(uuid) from public, anon;
grant execute on function public.marketplace_claim_free(uuid) to authenticated, service_role;

/**
 * A free listing is taken (above), never bought. An app from before free
 * listings shows it with "Sotib olish" and would open a 0 so‘m order and ask
 * for a card; refused here, on the rows themselves, so no purchase path —
 * `order_create_marketplace` or `marketplace_create_checkout` — can make one.
 */
create or replace function public.marketplace_refuse_free_purchase()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is null then
    return new;
  end if;
  if tg_table_name = 'orders' then
    if new.subtotal = 0 then
      raise exception 'Bu mahsulot tekin. Uni olish uchun ilovani yangilang.'
        using errcode = '22023', detail = 'free_listing';
    end if;
  elsif new.base_price = 0 then
    raise exception 'Bu mahsulot tekin. Uni olish uchun ilovani yangilang.'
      using errcode = '22023', detail = 'free_listing';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_refuse_free_purchase on public.orders;
create trigger orders_refuse_free_purchase
  before insert on public.orders
  for each row execute function public.marketplace_refuse_free_purchase();

drop trigger if exists payment_transactions_refuse_free_purchase on public.payment_transactions;
create trigger payment_transactions_refuse_free_purchase
  before insert on public.payment_transactions
  for each row execute function public.marketplace_refuse_free_purchase();

-- ------------------------------------------------------ the switch --
insert into public.app_settings (key, value, description, public_read)
values (
  'games.store_autopublish',
  '{"enabled": false}'::jsonb,
  'Auto-publish new O‘yingoh games to the store, free, an hour after they are made. Off until the apps from before 2.0 are gone and the public offer carries the clause.',
  false
)
on conflict (key) do nothing;

/** Whether new games are armed for the store, and armed games published. Off unless set to exactly true. */
create or replace function public.game_store_autopublish_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value ->> 'enabled' = 'true' from public.app_settings where key = 'games.store_autopublish'), false);
$$;

revoke all on function public.game_store_autopublish_enabled() from public, anon;
grant execute on function public.game_store_autopublish_enabled() to authenticated, service_role;

-- ----------------------------------------------------------- auto-publish --
alter table public.games
  add column if not exists store_autopublish text not null default 'off',
  add column if not exists store_autopublish_at timestamptz;
alter table public.games drop constraint if exists games_store_autopublish;
alter table public.games add constraint games_store_autopublish
  check (store_autopublish in ('off', 'pending', 'published', 'stopped'));

comment on column public.games.store_autopublish is
  'off (made before auto-publish, or never), pending (goes to the store free at store_autopublish_at), published, stopped (the owner kept it).';

/** A new game is set to go to the store an hour from now — while the switch is on. */
create or replace function public.game_store_autopublish_arm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.game_store_autopublish_enabled() then
    new.store_autopublish := 'off';
    new.store_autopublish_at := null;
    return new;
  end if;
  new.store_autopublish := 'pending';
  new.store_autopublish_at := now() + interval '1 hour';
  return new;
end;
$$;

drop trigger if exists games_store_autopublish_arm on public.games;
create trigger games_store_autopublish_arm
  before insert on public.games
  for each row execute function public.game_store_autopublish_arm();

/** The owner is told the moment the game exists, with both ways out. */
create or replace function public.game_store_autopublish_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    new.owner_id, 'game_store_autopublish',
    'O‘yiningiz do‘konga tekin chiqariladi',
    'O‘yiningiz 1 soatdan keyin do‘konga tekin chiqariladi. Uni pullik qilib qo‘yishingiz yoki jarayonni to‘xtatishingiz mumkin.',
    jsonb_build_object('game_id', new.id, 'publish_at', new.store_autopublish_at),
    '/oyingoh/publish/' || new.id::text,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists games_store_autopublish_notice on public.games;
create trigger games_store_autopublish_notice
  after insert on public.games
  for each row when (new.store_autopublish = 'pending')
  execute function public.game_store_autopublish_notice();

/** The owner keeps the game to themselves. */
create or replace function public.game_store_autopublish_stop(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.owner_id is distinct from auth.uid() then
    raise exception 'O‘yin topilmadi.' using errcode = 'P0002';
  end if;
  if v_game.store_autopublish = 'pending' then
    update public.games set store_autopublish = 'stopped' where id = p_game_id;
    v_game.store_autopublish := 'stopped';
  end if;
  return jsonb_build_object('game_id', v_game.id, 'state', v_game.store_autopublish, 'publish_at', v_game.store_autopublish_at);
end;
$$;

revoke all on function public.game_store_autopublish_stop(uuid) from public, anon;
grant execute on function public.game_store_autopublish_stop(uuid) to authenticated, service_role;

/**
 * Puts every game whose hour is up in the store, free. Run by pg_cron every
 * five minutes. A game still being written waits until it is ready; a game its
 * owner listed themselves (at any price, any state) is left to that listing.
 */
create or replace function public.game_store_publish_due(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_product uuid;
  v_done integer := 0;
begin
  -- Switched off, nothing goes; armed games wait for the switch.
  if not public.game_store_autopublish_enabled() then
    return 0;
  end if;
  for v_game in
    select g.* from public.games g
     where g.store_autopublish = 'pending'
       and g.store_autopublish_at <= now()
       and g.status = 'ready'::public.game_status
       and g.question_count >= 1
     order by g.store_autopublish_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  loop
    if exists (select 1 from public.marketplace_products p where p.game_id = v_game.id)
       or exists (select 1 from public.profiles pr where pr.id = v_game.owner_id and pr.status = 'blocked')
       or char_length(btrim(coalesce(v_game.title, ''))) < 3 then
      update public.games set store_autopublish = 'stopped' where id = v_game.id;
      continue;
    end if;

    insert into public.marketplace_products (
      seller_id, material_type, title, description, status, base_price,
      content_units, game_id, approval_source, moderation_note, published_at
    ) values (
      v_game.owner_id, 'game', left(btrim(v_game.title), 160), left(btrim(coalesce(v_game.description, '')), 4000),
      'approved'::public.marketplace_product_status, 0,
      greatest(v_game.question_count, 1), v_game.id, 'auto', 'Avtomatik: yaratilganidan 1 soat o‘tib tekin chiqarildi', now()
    )
    returning id into v_product;

    update public.games set store_autopublish = 'published' where id = v_game.id;

    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_game.owner_id, 'game_store_published',
      'O‘yiningiz do‘konda',
      'O‘yiningiz do‘konga tekin chiqdi. Xohlasangiz, unga narx qo‘yishingiz mumkin.',
      jsonb_build_object('game_id', v_game.id, 'product_id', v_product),
      '/oyingoh/publish/' || v_game.id::text,
      v_game.id
    );
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.game_store_publish_due(integer) from public, anon, authenticated;
grant execute on function public.game_store_publish_due(integer) to service_role;

-- Every five minutes, where pg_cron exists (the hosted project and the local stack).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('game-store-autopublish', '*/5 * * * *', 'select public.game_store_publish_due()');
  end if;
end
$$;

-- ------------------------------------------------------- free PPTX decks --
/** A deck may be put in the store free (price 0) as well as at a price in range. */
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
  -- 0 is free; any other price stays inside the operator's range.
  if p_price is null or (p_price <> 0 and (p_price < coalesce((v_settings ->> 'min_price')::integer, 1000)
     or p_price > coalesce((v_settings ->> 'max_price')::integer, 500000))) then
    raise exception 'Narx tekin (0) yoki % – % so‘m oralig‘ida bo‘lsin.', coalesce((v_settings ->> 'min_price')::integer, 1000), coalesce((v_settings ->> 'max_price')::integer, 500000)
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

-- ---------------------------------------------------- pricing an auto listing --
/**
 * Puts a price on the free listing auto-publish made, instead of a second
 * listing of the same game. A paid listing is reviewed like any other, so it
 * goes back to review; until approved it is not in the store.
 */
create or replace function public.game_store_reprice(p_game_id uuid, p_price integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_settings jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_product from public.marketplace_products
   where game_id = p_game_id and seller_id = v_user and approval_source = 'auto'
   order by created_at desc limit 1 for update;
  if not found then raise exception 'Mahsulot topilmadi.' using errcode = 'P0002'; end if;

  select coalesce(value, '{}'::jsonb) into v_settings from public.app_settings where key = 'marketplace.fast_publish';
  if p_price is null or p_price < coalesce((v_settings ->> 'min_price')::integer, 1000)
     or p_price > coalesce((v_settings ->> 'max_price')::integer, 500000) then
    raise exception 'Narx % – % so‘m oralig‘ida bo‘lsin.', coalesce((v_settings ->> 'min_price')::integer, 1000), coalesce((v_settings ->> 'max_price')::integer, 500000)
      using errcode = '22023';
  end if;

  update public.marketplace_products set
    base_price = p_price,
    status = 'pending_review'::public.marketplace_product_status,
    approval_source = null,
    moderation_note = 'Egasi narx qo‘ydi: tekshiruvga qaytdi'
   where id = v_product.id;
  return jsonb_build_object('product_id', v_product.id, 'status', 'pending_review', 'price', p_price);
end;
$$;

revoke all on function public.game_store_reprice(uuid, integer) from public, anon;
grant execute on function public.game_store_reprice(uuid, integer) to authenticated, service_role;
