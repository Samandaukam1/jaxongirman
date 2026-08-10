-- Everything the marketplace does, as checked server-side operations.
--
-- The shape of this file follows one rule: a client may ask for things and may
-- start a payment, but only the server may finish one. `marketplace_settle_payment`
-- is executable by the service role alone, and it is the single path that can
-- create an entitlement. No sequence of client calls reaches a downloadable file.

-- ------------------------------------------------------------------ search --
/**
 * The catalogue query. Filtering, sorting and paging all happen here so a
 * client never downloads the shelf to search it.
 */
create or replace function public.marketplace_search(
  p_query text default null,
  p_material_type text default null,
  p_category_id uuid default null,
  p_seller_id uuid default null,
  p_min_price integer default null,
  p_max_price integer default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  with matched as (
    select p.*
    from public.marketplace_products p
    where p.status = 'approved'::public.marketplace_product_status
      and (p_material_type is null or p.material_type = p_material_type)
      and (p_category_id is null or p.category_id = p_category_id)
      and (p_seller_id is null or p.seller_id = p_seller_id)
      and (p_min_price is null or p.base_price >= p_min_price)
      and (p_max_price is null or p.base_price <= p_max_price)
      and (
        v_term is null
        -- Full text for whole words, trigram for the prefixes people type.
        or p.search_text @@ plainto_tsquery('simple', v_term)
        or p.title ilike '%' || v_term || '%'
      )
  )
  select count(*), coalesce(jsonb_agg(entry order by ord), '[]'::jsonb)
    into v_total, v_items
  from (
    select
      row_number() over (
        order by
          case when p_sort = 'popular' then m.sales_count end desc nulls last,
          case when p_sort = 'rating' then
            case when m.rating_count = 0 then 0 else m.rating_sum::numeric / m.rating_count end
          end desc nulls last,
          case when p_sort = 'price_asc' then m.base_price end asc nulls last,
          case when p_sort = 'price_desc' then m.base_price end desc nulls last,
          m.published_at desc nulls last,
          m.id
      ) as ord,
      jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'material_type', m.material_type,
        'material_label', (select t.label from public.marketplace_material_types t where t.code = m.material_type),
        'category_id', m.category_id,
        'base_price', m.base_price,
        'currency', m.currency,
        'cover_path', m.cover_path,
        'content_units', m.content_units,
        'file_format', m.file_format,
        'has_study_guide', m.has_study_guide,
        'sales_count', m.sales_count,
        'rating', case when m.rating_count = 0 then null else round(m.rating_sum::numeric / m.rating_count, 2) end,
        'rating_count', m.rating_count,
        'seller_id', m.seller_id,
        'seller_name', (select coalesce(nullif(btrim(pr.full_name), ''), '—') from public.profiles pr where pr.id = m.seller_id),
        'published_at', m.published_at,
        'is_favorite', exists (
          select 1 from public.marketplace_favorites f
          where f.product_id = m.id and f.user_id = auth.uid()
        )
      ) as entry
    from matched m
  ) ranked
  where ord > v_offset and ord <= v_offset + v_limit;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    -- The quote travels with the list so a card can show the real payable
    -- amount without a second round trip per product.
    'commission', (select jsonb_build_object('buyer_fee_rate', c.buyer_fee_rate, 'seller_fee_rate', c.seller_fee_rate)
                   from public.commission_config c where c.scope = 'marketplace')
  );
end;
$$;

/** One listing, with everything the detail screen renders. */
create or replace function public.marketplace_product_detail(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not public.marketplace_can_see_product(p_product_id, v_user) then
    raise exception 'product is not available' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_product.id,
      'title', v_product.title,
      'description', v_product.description,
      'status', v_product.status,
      'material_type', v_product.material_type,
      'material_label', (select t.label from public.marketplace_material_types t where t.code = v_product.material_type),
      'supports_editor_import', (select t.supports_editor_import from public.marketplace_material_types t where t.code = v_product.material_type),
      'category_id', v_product.category_id,
      'base_price', v_product.base_price,
      'currency', v_product.currency,
      'cover_path', v_product.cover_path,
      'content_units', v_product.content_units,
      'file_format', v_product.file_format,
      'has_study_guide', v_product.has_study_guide,
      'sales_count', v_product.sales_count,
      'rating', case when v_product.rating_count = 0 then null else round(v_product.rating_sum::numeric / v_product.rating_count, 2) end,
      'rating_count', v_product.rating_count,
      'created_at', v_product.created_at,
      'updated_at', v_product.updated_at,
      'is_own', v_product.seller_id = v_user
    ),
    'seller', (
      select jsonb_build_object(
        'id', pr.id,
        'name', coalesce(nullif(btrim(pr.full_name), ''), '—'),
        'username', pr.username,
        'avatar_url', pr.avatar_url,
        'product_count', (select count(*) from public.marketplace_products sp
                          where sp.seller_id = pr.id and sp.status = 'approved'::public.marketplace_product_status)
      ) from public.profiles pr where pr.id = v_product.seller_id
    ),
    -- Preview paths only. The main file and the study guide are never named
    -- here; they are reached through the signing function after a purchase.
    'previews', coalesce((
      select jsonb_agg(jsonb_build_object('path', f.storage_path, 'mime_type', f.mime_type) order by f.position)
      from public.marketplace_product_files f
      where f.product_id = p_product_id and f.kind = 'preview'::public.marketplace_file_kind
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label))
      from public.marketplace_product_tags pt join public.marketplace_tags t on t.id = pt.tag_id
      where pt.product_id = p_product_id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at,
        'author', (select coalesce(nullif(btrim(pr.full_name), ''), '—') from public.profiles pr where pr.id = r.buyer_id)
      ) order by r.created_at desc)
      from (select * from public.marketplace_reviews mr where mr.product_id = p_product_id order by mr.created_at desc limit 20) r
    ), '[]'::jsonb),
    'quote', public.marketplace_quote(v_product.base_price),
    'owned', public.marketplace_has_entitlement(p_product_id, v_user),
    'is_favorite', exists (select 1 from public.marketplace_favorites f where f.product_id = p_product_id and f.user_id = v_user)
  );
end;
$$;

-- --------------------------------------------------------- seller authoring --
/**
 * Creates or rewrites a listing. Sending it for review is a separate, explicit
 * act — `p_submit` — so a half-filled draft never lands in the moderation queue.
 */
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
  p_submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_status public.marketplace_product_status;
begin
  if v_seller is null then raise exception 'authentication required' using errcode = '28000'; end if;

  -- Existence is the check; the row itself is only needed when files are attached.
  if not exists (select 1 from public.marketplace_material_types where code = p_material_type and is_active) then
    raise exception 'material type is unavailable' using errcode = '22023';
  end if;
  if p_base_price is null or p_base_price < 0 then
    raise exception 'price must not be negative' using errcode = '22023';
  end if;

  v_status := case when p_submit
    then 'pending_review'::public.marketplace_product_status
    else 'draft'::public.marketplace_product_status end;

  if p_product_id is null then
    insert into public.marketplace_products (
      seller_id, material_type, category_id, title, description, status,
      base_price, cover_path, content_units, file_format
    ) values (
      v_seller, p_material_type, p_category_id, btrim(p_title), left(btrim(coalesce(p_description, '')), 4000),
      v_status, p_base_price, p_cover_path, p_content_units, p_file_format
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
      content_units = p_content_units,
      file_format = p_file_format,
      -- An approved listing is pushed back to review by its own trigger; this
      -- only moves a draft forward when the seller asks for it.
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

/** Registers an uploaded object against a listing, with server-side type rules. */
create or replace function public.marketplace_attach_file(
  p_product_id uuid,
  p_kind public.marketplace_file_kind,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes integer,
  p_original_name text default '',
  p_position integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_type public.marketplace_material_types%rowtype;
  v_id uuid;
begin
  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.seller_id <> v_seller then
    raise exception 'only the seller may attach files' using errcode = '42501';
  end if;

  -- The object must live under this seller's own folder for this product.
  -- Anything else is a reference to a file they do not own.
  if p_storage_path not like v_seller::text || '/' || p_product_id::text || '/%' then
    raise exception 'file path does not belong to this product' using errcode = '42501';
  end if;

  select * into v_type from public.marketplace_material_types where code = v_product.material_type;

  if p_kind = 'main'::public.marketplace_file_kind then
    if not (p_mime_type = any(v_type.allowed_mime_types)) then
      raise exception 'this material type does not accept % files', p_mime_type using errcode = '22023';
    end if;
    if p_size_bytes > v_type.max_file_bytes then
      raise exception 'file exceeds the % byte limit for this material type', v_type.max_file_bytes using errcode = '22023';
    end if;
  elsif p_kind = 'study_guide'::public.marketplace_file_kind then
    if not v_type.supports_study_guide then
      raise exception 'this material type has no study guide' using errcode = '22023';
    end if;
  end if;

  insert into public.marketplace_product_files (
    product_id, kind, storage_path, mime_type, size_bytes, original_name, position
  ) values (
    p_product_id, p_kind, p_storage_path, p_mime_type, greatest(p_size_bytes, 1),
    left(btrim(coalesce(p_original_name, '')), 200), coalesce(p_position, 0)
  )
  on conflict do nothing
  returning id into v_id;

  if p_kind = 'study_guide'::public.marketplace_file_kind then
    update public.marketplace_products set has_study_guide = true where id = p_product_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- checkout --
/**
 * Opens a payment attempt.
 *
 * The price and both commissions are snapshotted onto the transaction here, so
 * a seller editing their price while a buyer is on the OTP screen cannot change
 * what that buyer agreed to. The idempotency key makes a double tap one attempt.
 */
create or replace function public.marketplace_create_checkout(
  p_product_id uuid,
  p_idempotency_key text,
  p_partial_card_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_product public.marketplace_products%rowtype;
  v_quote jsonb;
  v_existing public.payment_transactions%rowtype;
  v_transaction public.payment_transactions%rowtype;
  v_key text;
begin
  if v_buyer is null then raise exception 'authentication required' using errcode = '28000'; end if;
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;

  select * into v_product from public.marketplace_products where id = p_product_id;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'approved'::public.marketplace_product_status then
    raise exception 'Mahsulot sotuvda emas.' using errcode = '42501';
  end if;
  if v_product.seller_id = v_buyer then
    raise exception 'O‘z mahsulotingizni sotib ololmaysiz.' using errcode = '22023';
  end if;
  if public.marketplace_has_entitlement(p_product_id, v_buyer) then
    raise exception 'Bu mahsulot allaqachon sizda bor.' using errcode = '22023';
  end if;

  -- A replay of the same attempt returns the same transaction rather than
  -- opening a second one against the same card press.
  select * into v_existing from public.payment_transactions
    where buyer_id = v_buyer and idempotency_key = v_key;
  if found then
    return jsonb_build_object('transaction_id', v_existing.id, 'state', v_existing.state, 'reused', true,
      'buyer_total', v_existing.buyer_total, 'base_price', v_existing.base_price,
      'buyer_fee_amount', v_existing.buyer_fee_amount, 'currency', v_existing.currency);
  end if;

  if p_partial_card_id is not null and not exists (
    select 1 from public.partial_cards c where c.id = p_partial_card_id and c.user_id = v_buyer and c.is_active
  ) then
    raise exception 'card not found' using errcode = 'P0002';
  end if;

  v_quote := public.marketplace_quote(v_product.base_price);

  insert into public.payment_transactions (
    buyer_id, product_id, seller_id, base_price, currency,
    buyer_fee_rate, buyer_fee_amount, buyer_total,
    seller_fee_rate, seller_fee_amount, seller_net, platform_gross,
    partial_card_id, idempotency_key
  ) values (
    v_buyer, p_product_id, v_product.seller_id, v_product.base_price, v_product.currency,
    (v_quote ->> 'buyer_fee_rate')::numeric, (v_quote ->> 'buyer_fee_amount')::integer, (v_quote ->> 'buyer_total')::integer,
    (v_quote ->> 'seller_fee_rate')::numeric, (v_quote ->> 'seller_fee_amount')::integer,
    (v_quote ->> 'seller_net')::integer, (v_quote ->> 'platform_gross')::integer,
    p_partial_card_id, v_key
  )
  returning * into v_transaction;

  insert into public.payment_audit_events (transaction_id, event, state_to, message)
  values (v_transaction.id, 'checkout.created', v_transaction.state, 'Checkout opened');

  return jsonb_build_object(
    'transaction_id', v_transaction.id,
    'state', v_transaction.state,
    'reused', false,
    'base_price', v_transaction.base_price,
    'buyer_fee_amount', v_transaction.buyer_fee_amount,
    'buyer_total', v_transaction.buyer_total,
    'currency', v_transaction.currency
  );
end;
$$;

-- --------------------------------------------------------- payment machine --
/** The only legal moves. Anything not listed here is refused, not logged. */
create or replace function public.payment_transition_allowed(
  p_from public.payment_state,
  p_to public.payment_state
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('created', 'card_created'), ('created', 'failed'), ('created', 'cancelled'),
    ('card_created', 'otp_requested'), ('card_created', 'failed'), ('card_created', 'cancelled'),
    ('otp_requested', 'card_verified'), ('otp_requested', 'otp_requested'),
    ('otp_requested', 'failed'), ('otp_requested', 'cancelled'),
    ('card_verified', 'receipt_created'), ('card_verified', 'failed'), ('card_verified', 'cancelled'),
    ('receipt_created', 'processing'), ('receipt_created', 'failed'), ('receipt_created', 'cancelled'),
    ('processing', 'paid'), ('processing', 'failed'),
    ('paid', 'refunded')
  );
$$;

/**
 * Advances a payment. Server-side only: the service role is the only grantee,
 * because the caller of this function is asserting what the provider said.
 */
create or replace function public.payment_advance(
  p_transaction_id uuid,
  p_to public.payment_state,
  p_event text default '',
  p_provider_receipt_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null
)
returns public.payment_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.payment_transactions%rowtype;
  v_from public.payment_state;
  v_message text;
begin
  select * into v_transaction from public.payment_transactions where id = p_transaction_id for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;

  v_from := v_transaction.state;
  if not public.payment_transition_allowed(v_from, p_to) then
    raise exception 'payment cannot move from % to %', v_from, p_to using errcode = '22023';
  end if;

  -- Redacted before storage, not after. A provider message that quotes a card
  -- number must not become the reason this row violates its own constraint.
  v_message := regexp_replace(coalesce(p_provider_error_message, ''), '[0-9]{12,}', '[redacted]', 'g');

  update public.payment_transactions set
    state = p_to,
    provider_receipt_id = coalesce(p_provider_receipt_id, provider_receipt_id),
    provider_error_code = case when p_to = 'failed'::public.payment_state then p_provider_error_code else provider_error_code end,
    provider_error_message = case when p_to = 'failed'::public.payment_state then nullif(v_message, '') else provider_error_message end,
    paid_at = case when p_to = 'paid'::public.payment_state then now() else paid_at end,
    failed_at = case when p_to = 'failed'::public.payment_state then now() else failed_at end
    where id = p_transaction_id
    returning * into v_transaction;

  insert into public.payment_audit_events (transaction_id, event, state_from, state_to, provider_code, message)
  values (
    p_transaction_id, left(coalesce(nullif(btrim(p_event), ''), 'state.change'), 100),
    v_from, p_to, p_provider_error_code, left(v_message, 1000)
  );

  return v_transaction;
end;
$$;

/**
 * Turns a confirmed payment into everything it entitles.
 *
 * Purchase, entitlement, seller ledger row and both notifications in one
 * transaction — either the buyer can download and the seller is owed, or
 * neither happened. Idempotent: settling twice returns the first result.
 */
create or replace function public.marketplace_settle_payment(
  p_transaction_id uuid,
  p_provider_cost integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.payment_transactions%rowtype;
  v_product public.marketplace_products%rowtype;
  v_purchase public.marketplace_purchases%rowtype;
begin
  select * into v_transaction from public.payment_transactions where id = p_transaction_id for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;

  select * into v_purchase from public.marketplace_purchases where transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object('applied', false, 'purchase_id', v_purchase.id, 'message', 'already settled');
  end if;

  if v_transaction.state <> 'processing'::public.payment_state then
    raise exception 'only a processing payment can settle' using errcode = '22023';
  end if;

  select * into v_product from public.marketplace_products where id = v_transaction.product_id;

  update public.payment_transactions
    set state = 'paid'::public.payment_state, paid_at = now(), provider_cost = greatest(coalesce(p_provider_cost, 0), 0)
    where id = p_transaction_id
    returning * into v_transaction;

  insert into public.marketplace_purchases (
    transaction_id, buyer_id, seller_id, product_id,
    base_price, currency, buyer_fee_rate, buyer_fee_amount, buyer_total,
    seller_fee_rate, seller_fee_amount, seller_net, platform_gross, provider_cost
  ) values (
    v_transaction.id, v_transaction.buyer_id, v_transaction.seller_id, v_transaction.product_id,
    v_transaction.base_price, v_transaction.currency,
    v_transaction.buyer_fee_rate, v_transaction.buyer_fee_amount, v_transaction.buyer_total,
    v_transaction.seller_fee_rate, v_transaction.seller_fee_amount, v_transaction.seller_net,
    v_transaction.platform_gross, v_transaction.provider_cost
  )
  returning * into v_purchase;

  insert into public.purchase_entitlements (purchase_id, user_id, product_id)
  values (v_purchase.id, v_transaction.buyer_id, v_transaction.product_id);

  insert into public.seller_ledger_entries (
    seller_id, purchase_id, product_id, gross_amount, fee_amount, net_amount, currency
  ) values (
    v_transaction.seller_id, v_purchase.id, v_transaction.product_id,
    v_transaction.base_price, v_transaction.seller_fee_amount, v_transaction.seller_net, v_transaction.currency
  );

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_transaction.buyer_id, 'marketplace_purchase',
    'Xarid muvaffaqiyatli',
    '“' || v_product.title || '” endi kutubxonangizda. Yuklab olishingiz mumkin.',
    jsonb_build_object('product_id', v_product.id, 'purchase_id', v_purchase.id, 'amount', v_transaction.buyer_total),
    '/(app)/marketplace/library', v_purchase.id
  );

  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_transaction.seller_id, 'marketplace_sale',
    'Yangi sotuv',
    '“' || v_product.title || '” sotildi. Sizga hisoblandi: ' || v_transaction.seller_net || ' so‘m.',
    jsonb_build_object('product_id', v_product.id, 'purchase_id', v_purchase.id, 'net', v_transaction.seller_net),
    '/(app)/earnings', v_purchase.id
  );

  insert into public.payment_audit_events (transaction_id, event, state_from, state_to, message)
  values (p_transaction_id, 'payment.settled', 'processing'::public.payment_state, 'paid'::public.payment_state, 'Entitlement granted');

  return jsonb_build_object('applied', true, 'purchase_id', v_purchase.id, 'entitlement', true);
end;
$$;

/**
 * Remembers a card as a masked display string after a payment succeeded.
 *
 * Server-side only, and it takes the two ends of the number rather than the
 * number: there is no argument here that could carry a full PAN, so a caller
 * cannot pass one even by mistake.
 */
create or replace function public.marketplace_remember_partial_card(
  p_user_id uuid,
  p_first8 text,
  p_last4 text,
  p_expiry_month smallint,
  p_expiry_year smallint
)
returns public.partial_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.partial_cards%rowtype;
begin
  if p_first8 !~ '^[0-9]{8}$' or p_last4 !~ '^[0-9]{4}$' then
    raise exception 'card fragments are malformed' using errcode = '22023';
  end if;

  insert into public.partial_cards (user_id, display_pan, last4, expiry_month, expiry_year, last_used_at)
  values (p_user_id, p_first8 || 'XXXX' || p_last4, p_last4, p_expiry_month, p_expiry_year, now())
  on conflict (user_id, display_pan) do update
    set last_used_at = now(), is_active = true, expiry_month = excluded.expiry_month, expiry_year = excluded.expiry_year
  returning * into v_card;

  return v_card;
end;
$$;

-- -------------------------------------------------------------- moderation --
/** Approve, reject, hide or restore a listing. Audited, and the seller is told. */
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
    when 'hide' then 'hidden'::public.marketplace_product_status
    when 'restore' then 'approved'::public.marketplace_product_status
    when 'archive' then 'archived'::public.marketplace_product_status
    else null
  end;
  if v_status is null then raise exception 'unknown moderation action %', p_action using errcode = '22023'; end if;
  if v_status = 'rejected'::public.marketplace_product_status and v_reason = '' then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;

  select * into v_before from public.marketplace_products where id = p_product_id for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;

  update public.marketplace_products set
    status = v_status,
    published_at = case
      when v_status = 'approved'::public.marketplace_product_status then coalesce(v_before.published_at, now())
      else v_before.published_at end,
    rejection_reason = case when v_status = 'rejected'::public.marketplace_product_status then v_reason else null end,
    moderated_by = v_admin,
    moderated_at = now()
    where id = p_product_id
    returning * into v_after;

  if v_status in ('approved'::public.marketplace_product_status, 'rejected'::public.marketplace_product_status) then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_before.seller_id,
      (case when v_status = 'approved'::public.marketplace_product_status
        then 'product_approved' else 'product_rejected' end)::public.notification_kind,
      case when v_status = 'approved'::public.marketplace_product_status then 'Mahsulot tasdiqlandi' else 'Mahsulot qaytarildi' end,
      case when v_status = 'approved'::public.marketplace_product_status
        then '“' || v_before.title || '” endi Do‘konda ko‘rinadi.'
        else '“' || v_before.title || '” qaytarildi. Sabab: ' || v_reason end,
      jsonb_build_object('product_id', p_product_id, 'status', v_status),
      '/(app)/marketplace/seller', p_product_id
    );
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (
    v_admin, 'marketplace.moderate', 'marketplace_product', p_product_id::text,
    jsonb_build_object('status', v_before.status, 'title', v_before.title),
    jsonb_build_object('status', v_after.status), v_reason
  );

  return v_after;
end;
$$;

/** Changes the platform's cut. Both rates, one audited write. */
create or replace function public.admin_set_commission(
  p_buyer_fee_rate numeric,
  p_seller_fee_rate numeric,
  p_reason text default '',
  p_scope text default 'marketplace'
)
returns public.commission_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.commission_config%rowtype;
  v_after public.commission_config%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_buyer_fee_rate is null or p_seller_fee_rate is null
     or p_buyer_fee_rate < 0 or p_buyer_fee_rate > 100
     or p_seller_fee_rate < 0 or p_seller_fee_rate > 100 then
    raise exception 'commission rates must be between 0 and 100' using errcode = '22023';
  end if;

  select * into v_before from public.commission_config where scope = p_scope for update;
  if not found then raise exception 'commission scope % is not configured', p_scope using errcode = '22023'; end if;

  update public.commission_config
    set buyer_fee_rate = p_buyer_fee_rate, seller_fee_rate = p_seller_fee_rate, updated_by = v_admin
    where scope = p_scope
    returning * into v_after;

  insert into public.commission_history (
    scope, old_buyer_fee_rate, old_seller_fee_rate, new_buyer_fee_rate, new_seller_fee_rate, changed_by, reason
  ) values (
    p_scope, v_before.buyer_fee_rate, v_before.seller_fee_rate,
    v_after.buyer_fee_rate, v_after.seller_fee_rate, v_admin, left(btrim(coalesce(p_reason, '')), 500)
  );

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'marketplace.commission', 'commission_config', p_scope, to_jsonb(v_before), to_jsonb(v_after),
          left(btrim(coalesce(p_reason, '')), 500));

  return v_after;
end;
$$;

-- ------------------------------------------------------------- settlements --
/** What a seller has sold, is owed, and has been paid. */
create or replace function public.seller_earnings_summary(p_seller_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_seller_id <> v_caller and not public.is_admin(v_caller) then
    raise exception 'only the seller may read these earnings' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'sales_count', (select count(*) from public.seller_ledger_entries where seller_id = p_seller_id),
    'gross_total', (select coalesce(sum(gross_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id),
    'fee_total', (select coalesce(sum(fee_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id),
    'net_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries where seller_id = p_seller_id),
    'pending_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                      where seller_id = p_seller_id and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)),
    'paid_total', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                   where seller_id = p_seller_id and status = 'paid'::public.seller_ledger_status),
    'contact', (select jsonb_build_object('phone', c.phone, 'telegram_username', c.telegram_username)
                from public.seller_payout_contacts c where c.user_id = p_seller_id),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'period_start', s.period_start, 'period_end', s.period_end,
        'gross_sales', s.gross_sales, 'seller_fees', s.seller_fees, 'payable_amount', s.payable_amount,
        'currency', s.currency, 'status', s.status,
        'destination_note', s.destination_note, 'reference', s.reference,
        'paid_at', s.paid_at, 'created_at', s.created_at
      ) order by s.period_end desc)
      from public.seller_settlements s where s.seller_id = p_seller_id
    ), '[]'::jsonb)
  );
end;
$$;

/**
 * Gathers a seller's unsettled sales into one payout run.
 *
 * Each ledger entry is claimed by exactly one settlement — the unique key on
 * `seller_settlement_items.ledger_entry_id` is what makes that true even if two
 * admins press the button at the same moment.
 */
create or replace function public.admin_create_settlement(
  p_seller_id uuid,
  p_period_start date,
  p_period_end date
)
returns public.seller_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_settlement public.seller_settlements%rowtype;
  v_gross integer;
  v_fees integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  insert into public.seller_settlements (seller_id, period_start, period_end, status, created_by)
  values (p_seller_id, p_period_start, p_period_end, 'pending'::public.settlement_status, v_admin)
  returning * into v_settlement;

  -- `for update skip locked` so a concurrent run takes different rows rather
  -- than waiting and then failing on the unique key.
  with claimed as (
    select id, gross_amount, fee_amount
    from public.seller_ledger_entries
    where seller_id = p_seller_id
      and settlement_id is null
      and status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)
      and created_at::date between p_period_start and p_period_end
    for update skip locked
  ), linked as (
    insert into public.seller_settlement_items (settlement_id, ledger_entry_id)
    select v_settlement.id, id from claimed
    on conflict (ledger_entry_id) do nothing
    returning ledger_entry_id
  )
  select coalesce(sum(c.gross_amount), 0), coalesce(sum(c.fee_amount), 0)
    into v_gross, v_fees
  from claimed c join linked l on l.ledger_entry_id = c.id;

  update public.seller_ledger_entries
    set settlement_id = v_settlement.id, status = 'approved'::public.seller_ledger_status
    where id in (select ledger_entry_id from public.seller_settlement_items where settlement_id = v_settlement.id);

  update public.seller_settlements
    set gross_sales = v_gross, seller_fees = v_fees, payable_amount = v_gross - v_fees
    where id = v_settlement.id
    returning * into v_settlement;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'settlement.create', 'seller_settlement', v_settlement.id::text, '{}'::jsonb, to_jsonb(v_settlement), 'Payout run created');

  return v_settlement;
end;
$$;

/**
 * Tells a seller their payout is coming, once.
 *
 * `notified_upcoming_at` is the guard: a scheduler can run this every hour and
 * the seller still hears about it a single time.
 */
create or replace function public.notify_upcoming_settlements(p_days_ahead integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.seller_settlements%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select * from public.seller_settlements
    where status = 'pending'::public.settlement_status
      and notified_upcoming_at is null
      and period_end <= (current_date + make_interval(days => greatest(coalesce(p_days_ahead, 7), 0)))
    for update skip locked
  loop
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_row.seller_id, 'settlement_upcoming',
      'To‘lovga 7 kun qoldi',
      'Daromadingiz ' || v_row.payable_amount || ' so‘m. Buxgalter siz bilan bog‘lanadi — '
        || 'aloqa uchun Telegram profilingizni yuboring yoki qoldirgan raqamingiz orqali kutib turing. '
        || 'Bu haqda sizga SMS ham yuboriladi.',
      jsonb_build_object('settlement_id', v_row.id, 'payable_amount', v_row.payable_amount),
      '/(app)/earnings', v_row.id
    );

    update public.seller_settlements set notified_upcoming_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/**
 * Records that the money left. The destination is a masked note — the check
 * constraint on the column refuses anything with a card-length digit run.
 */
create or replace function public.admin_mark_settlement_paid(
  p_settlement_id uuid,
  p_destination_note text,
  p_reference text default ''
)
returns public.seller_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.seller_settlements%rowtype;
  v_after public.seller_settlements%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select * into v_before from public.seller_settlements where id = p_settlement_id for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  if v_before.status = 'paid'::public.settlement_status then
    return v_before;
  end if;

  update public.seller_settlements set
    status = 'paid'::public.settlement_status,
    destination_note = left(btrim(coalesce(p_destination_note, '')), 200),
    reference = left(btrim(coalesce(p_reference, '')), 200),
    paid_at = now(),
    paid_by = v_admin
    where id = p_settlement_id
    returning * into v_after;

  update public.seller_ledger_entries
    set status = 'paid'::public.seller_ledger_status
    where settlement_id = p_settlement_id;

  -- The celebratory one, like a coin gift: the app opens Daromadlar from here.
  insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
  values (
    v_after.seller_id, 'settlement_paid',
    v_after.payable_amount || ' so‘m to‘landi',
    'Daromadingiz ' || coalesce(nullif(v_after.destination_note, ''), 'ko‘rsatilgan hisobga') || ' o‘tkazildi.',
    jsonb_build_object('settlement_id', v_after.id, 'amount', v_after.payable_amount, 'destination', v_after.destination_note),
    '/(app)/earnings', v_after.id
  );

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'settlement.paid', 'seller_settlement', p_settlement_id::text, to_jsonb(v_before), to_jsonb(v_after),
          left(btrim(coalesce(p_reference, '')), 500));

  return v_after;
end;
$$;

-- ---------------------------------------------------------- admin finance --
/**
 * The finance dashboard, from the ledger rather than from anything remembered.
 *
 * Fees are counted once each: platform gross is buyer fees plus seller fees, and
 * the money the buyer handed over is base plus buyer fee. Adding those two
 * together would count the base twice, which is the classic way these reports go
 * wrong.
 */
create or replace function public.admin_marketplace_finance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_period record;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  for v_period in
    select * from (values
      ('today', date_trunc('day', now())),
      ('week', date_trunc('week', now())),
      ('month', date_trunc('month', now())),
      ('all_time', '-infinity'::timestamptz)
    ) as t(label, since)
  loop
    v_result := v_result || jsonb_build_object(v_period.label, (
      select jsonb_build_object(
        'gmv', coalesce(sum(base_price), 0),
        'buyer_fees', coalesce(sum(buyer_fee_amount), 0),
        'seller_fees', coalesce(sum(seller_fee_amount), 0),
        'buyer_collected', coalesce(sum(base_price + buyer_fee_amount), 0),
        'seller_payable', coalesce(sum(base_price - seller_fee_amount), 0),
        'platform_gross', coalesce(sum(platform_gross), 0),
        'provider_costs', coalesce(sum(provider_cost), 0),
        'refunded', coalesce(sum(refunded_amount), 0),
        'platform_net', coalesce(sum(platform_gross - provider_cost), 0) - coalesce(sum(refunded_amount), 0),
        'sales_count', count(*),
        'average_order_value', case when count(*) = 0 then 0
          else round(coalesce(sum(base_price + buyer_fee_amount), 0)::numeric / count(*)) end
      )
      from public.marketplace_purchases
      where purchased_at >= v_period.since
    ));
  end loop;

  return v_result || jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'gmv', d.gmv, 'platform_gross', d.platform_gross, 'sales_count', d.sales_count
      ) order by d.day)
      from (
        select purchased_at::date as day,
               sum(base_price) as gmv,
               sum(platform_gross) as platform_gross,
               count(*) as sales_count
        from public.marketplace_purchases
        where purchased_at >= now() - interval '30 days'
        group by 1
      ) d
    ), '[]'::jsonb),
    'pending_moderation', (select count(*) from public.marketplace_products
                           where status = 'pending_review'::public.marketplace_product_status),
    'open_reports', (select count(*) from public.marketplace_reports
                     where status in ('open'::public.marketplace_report_status, 'reviewing'::public.marketplace_report_status)),
    'unsettled_payable', (select coalesce(sum(net_amount), 0) from public.seller_ledger_entries
                          where status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status))
  );
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  -- Callable by a signed-in person.
  foreach v_signature in array array[
    'public.marketplace_search(text, text, uuid, uuid, integer, integer, text, integer, integer)',
    'public.marketplace_product_detail(uuid)',
    'public.marketplace_save_product(uuid, text, text, text, integer, uuid, text, integer, text, boolean)',
    'public.marketplace_attach_file(uuid, public.marketplace_file_kind, text, text, integer, text, integer)',
    'public.marketplace_create_checkout(uuid, text, uuid)',
    'public.seller_earnings_summary(uuid)',
    'public.admin_moderate_product(uuid, text, text)',
    'public.admin_set_commission(numeric, numeric, text, text)',
    'public.admin_create_settlement(uuid, date, date)',
    'public.admin_mark_settlement_paid(uuid, text, text)',
    'public.admin_marketplace_finance()'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  -- Server only. These assert what the payment provider said, so a client
  -- holding one of them would be a client that can grant itself a purchase.
  foreach v_signature in array array[
    'public.payment_advance(uuid, public.payment_state, text, text, text, text)',
    'public.marketplace_settle_payment(uuid, integer)',
    'public.marketplace_remember_partial_card(uuid, text, text, smallint, smallint)',
    'public.notify_upcoming_settlements(integer)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('revoke all on function %s from authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;

revoke all on function public.payment_transition_allowed(public.payment_state, public.payment_state) from anon;
