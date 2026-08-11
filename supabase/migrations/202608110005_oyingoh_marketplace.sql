-- O‘yingoh meets the do‘kon: a game becomes a listing without becoming a copy.
--
-- A game product carries no file. The product row *references* the game, the
-- purchase grants the same entitlement row every other product grants, and
-- hosting rights flow from that entitlement — the seller keeps the only copy,
-- exactly as the master licensing rule wants. Editing the listing (or pointing
-- it at a different game) sends an approved product back to review, the same
-- as retitling a document does.

-- The catalogue learns the new kind. The MIME list is a placeholder the
-- constraint requires: no file is ever uploaded for a game listing, so nothing
-- will ever be validated against it.
insert into public.marketplace_material_types (
  code, label, description, allowed_mime_types, max_file_bytes,
  supports_study_guide, supports_editor_import, sort_order
) values (
  'game', 'O‘yin', 'O‘yingoh o‘yini — xarid qilgach kutubxonangizdan boshlab o‘tkazasiz',
  array['application/x-jaxongirman-game'], 1024, false, false, 40
)
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

alter table public.marketplace_products
  add column game_id uuid references public.games(id) on delete restrict,
  add constraint marketplace_products_game_binding check (
    (material_type = 'game') = (game_id is not null)
  );

create index marketplace_products_game_idx on public.marketplace_products (game_id)
  where game_id is not null;

-- Approval covers the game that was approved: swapping the reference reopens
-- review, like every other buyer-visible edit.
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
       or new.game_id is distinct from old.game_id
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

-- The save RPC gains one parameter. Dropped and recreated rather than
-- overloaded: two signatures whose extra arguments all have defaults would be
-- ambiguous to PostgREST, and every existing caller uses named arguments.
drop function public.marketplace_save_product(uuid, text, text, text, integer, uuid, text, integer, text, boolean);

create or replace function public.marketplace_save_product(
  p_product_id uuid,
  p_material_type text,
  p_title text,
  p_description text default '',
  p_base_price integer default 0,
  p_category_id uuid default null,
  p_cover_path text default null,
  p_content_units integer default null,
  p_file_format text default null,
  p_submit boolean default false,
  p_game_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_game public.games%rowtype;
  v_status public.marketplace_product_status;
  v_game_id uuid := p_game_id;
  v_content_units integer := p_content_units;
begin
  if v_seller is null then raise exception 'authentication required' using errcode = '28000'; end if;

  if not exists (select 1 from public.marketplace_material_types where code = p_material_type and is_active) then
    raise exception 'material type is unavailable' using errcode = '22023';
  end if;
  if p_base_price is null or p_base_price < 0 then
    raise exception 'price must not be negative' using errcode = '22023';
  end if;

  -- A game listing must point at a hostable game the seller owns; anything
  -- else must not point at a game at all. The check constraint would catch
  -- both, but these messages name the actual problem.
  if p_material_type = 'game' then
    if v_game_id is null then
      raise exception 'O‘yin tanlanmagan.' using errcode = '22023';
    end if;
    select * into v_game from public.games where id = v_game_id;
    if not found or v_game.owner_id <> v_seller then
      raise exception 'O‘yin topilmadi yoki sizga tegishli emas.' using errcode = '42501';
    end if;
    if v_game.status <> 'ready'::public.game_status then
      raise exception 'Avval o‘yinni tayyor holatga keltiring.' using errcode = '22023';
    end if;
    v_content_units := v_game.question_count;
  else
    v_game_id := null;
  end if;

  v_status := case when p_submit
    then 'pending_review'::public.marketplace_product_status
    else 'draft'::public.marketplace_product_status end;

  if p_product_id is null then
    insert into public.marketplace_products (
      seller_id, material_type, category_id, title, description, status,
      base_price, cover_path, content_units, file_format, game_id
    ) values (
      v_seller, p_material_type, p_category_id, btrim(p_title), left(btrim(coalesce(p_description, '')), 4000),
      v_status, p_base_price, p_cover_path, v_content_units, p_file_format, v_game_id
    )
    returning * into v_product;
  else
    select * into v_product from public.marketplace_products where id = p_product_id for update;
    if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
    if v_product.seller_id <> v_seller then
      raise exception 'only the seller may edit this product' using errcode = '42501';
    end if;

    update public.marketplace_products set
      material_type = p_material_type,
      category_id = p_category_id,
      title = btrim(p_title),
      description = left(btrim(coalesce(p_description, '')), 4000),
      base_price = p_base_price,
      cover_path = p_cover_path,
      content_units = v_content_units,
      file_format = p_file_format,
      game_id = v_game_id,
      status = case
        when p_submit and v_product.status in (
          'draft'::public.marketplace_product_status, 'rejected'::public.marketplace_product_status
        ) then 'pending_review'::public.marketplace_product_status
        else v_product.status
      end,
      rejection_reason = case when p_submit then null else v_product.rejection_reason end
      where id = v_product.id
      returning * into v_product;
  end if;

  return v_product.id;
end;
$$;

revoke all on function public.marketplace_save_product(uuid, text, text, text, integer, uuid, text, integer, text, boolean, uuid) from public, anon;
grant execute on function public.marketplace_save_product(uuid, text, text, text, integer, uuid, text, integer, text, boolean, uuid) to authenticated, service_role;

/**
 * Hosting rights, now including bought ones: your own ready game, a free one,
 * or one whose listing you hold a live entitlement to. The listing may later
 * be hidden or archived — the purchase survives that, deliberately.
 */
create or replace function public.game_can_host(p_game_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and g.status = 'ready'::public.game_status
      and (
        g.owner_id = p_user_id
        or g.is_free
        or exists (
          select 1
          from public.purchase_entitlements e
          join public.marketplace_products p on p.id = e.product_id
          where p.game_id = g.id and e.user_id = p_user_id and e.revoked_at is null
        )
      )
  );
$$;

-- A buyer sees the game row their entitlement points at: the library needs a
-- title and a cover. Questions stay with the owner — play flows sanitise them.
create policy games_entitled_select on public.games for select to authenticated
  using (
    exists (
      select 1
      from public.purchase_entitlements e
      join public.marketplace_products p on p.id = e.product_id
      where p.game_id = games.id and e.user_id = (select auth.uid()) and e.revoked_at is null
    )
  );

/**
 * What a shopper may know before paying: the shape of the game, never its
 * content. Question texts, options and answers stay behind the purchase.
 */
create or replace function public.game_listing_preview(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.marketplace_products%rowtype;
  v_game public.games%rowtype;
begin
  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found or v_product.game_id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  if not public.marketplace_can_see_product(p_product_id, auth.uid()) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select * into v_game from public.games where id = v_product.game_id;

  return jsonb_build_object(
    'game_id', v_game.id,
    'question_count', v_game.question_count,
    'difficulty', v_game.difficulty,
    'audience', v_game.audience,
    'category_id', v_game.category_id,
    'types', coalesce((
      select jsonb_object_agg(t.type, t.cnt) from (
        select q.type::text as type, count(*)::integer as cnt
        from public.game_questions q
        where q.game_id = v_game.id
        group by q.type
      ) as t
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.game_listing_preview(uuid) from public, anon;
grant execute on function public.game_listing_preview(uuid) to authenticated, service_role;
