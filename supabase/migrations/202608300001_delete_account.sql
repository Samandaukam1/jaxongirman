/**
 * Deleting your own account — and the small part of it the books will not let go.
 *
 * An account is not one row. It is a profile, a wallet, decks and their slides,
 * games, surveys, uploads in ten buckets, and a handful of records that exist
 * because money moved. The first group belongs to the person and goes when they
 * go. The second does not belong to them alone: a purchase has a buyer on one
 * side and a seller on the other, and neither can delete the receipt of a sale
 * the other one paid for. The schema already says so — `orders.seller_id`,
 * `payment_transactions.seller_id`, `marketplace_purchases.seller_id` and
 * `seller_settlements.seller_id` all say `on delete restrict`, which is Postgres
 * refusing, correctly, to let an accounting record lose the party it names.
 *
 * So there are two outcomes rather than one, and which applies is a fact about
 * the account rather than a setting:
 *
 * - No money ever moved through this account. Everything goes, including the
 *   `auth.users` row, and every cascade in the schema fires behind it.
 * - Some did. Everything personal still goes — name, handle, bio, avatar,
 *   decks, games, uploads, cards, sessions — and what is left is a ledger row
 *   with an id in it and no person behind it. The id is not the person: nothing
 *   readable, contactable or identifying survives this function.
 *
 * `account_retention_reasons` is what decides, and it is deliberately a list of
 * sentences rather than a boolean, because "your account could not be erased
 * outright" is a thing somebody is owed an explanation for.
 *
 * Both functions are service-role only. There is no path from a signed-in
 * client to either of them; the Edge Function `delete-account` is the only
 * caller, and it checks that the session it holds belongs to the id it passes.
 */

-- ------------------------------------------------------------ what must stay --

create or replace function public.account_retention_reasons(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(reason), '{}'::text[])
  from (
    -- Sold something. The buyer's receipt names this seller.
    select 'marketplace_sales' as reason
     where exists (select 1 from public.marketplace_purchases where seller_id = p_user)
    union all
    select 'payments_received'
     where exists (select 1 from public.payment_transactions where seller_id = p_user)
    union all
    select 'orders_fulfilled'
     where exists (select 1 from public.orders where seller_id = p_user)
    union all
    select 'seller_settlements'
     where exists (select 1 from public.seller_settlements where seller_id = p_user)
    -- Paid for something. A payment the platform actually took is a record the
    -- platform has to be able to produce later; an abandoned checkout is not,
    -- which is why the states are named rather than the table merely counted.
    union all
    select 'payments_made'
     where exists (
       select 1 from public.orders
        where user_id = p_user and status in ('paid', 'refunded')
     )
    union all
    select 'card_payments_made'
     where exists (
       select 1 from public.payment_transactions
        where buyer_id = p_user and state in ('paid', 'refunded')
     )
    union all
    select 'admin_audit_trail'
     where exists (select 1 from public.admin_audit_logs where admin_id = p_user)
  ) as reasons;
$$;

comment on function public.account_retention_reasons(uuid) is
  'Why this account cannot be erased outright: the financial and audit records that name it.';

-- ------------------------------------------------------------------ the purge --

create or replace function public.purge_account_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  /**
   * The ledgers. Never emptied here, by this function or by a cascade it sets
   * off, because emptying one is not a privacy action — it is a hole in a set
   * of books that has another party in it.
   *
   * `credit_transactions` is on the list for the same reason as the rest: J
   * Tanga are bought with money, and the transaction log is how a balance can
   * be explained to the person who paid for it.
   */
  retained constant text[] := array[
    'orders',
    'payment_transactions',
    'marketplace_purchases',
    'seller_ledger_entries',
    'seller_settlements',
    'credit_transactions',
    'user_subscriptions',
    'subscription_restarts'
  ];

  /**
   * Tables this function handles itself, further down, and must therefore keep
   * the generic sweep away from: two of them have rows that survive as
   * archives, and the profile is scrubbed rather than dropped so that every
   * guard and every join in the app still resolves to something.
   */
  handled constant text[] := array['profiles', 'marketplace_products', 'games'];

  /**
   * Buckets a person's own files can be in. Every one of them writes
   * `<user id>/…` as the first path segment — that is not a convention this
   * function invented, it is what each bucket's own RLS policy enforces on
   * insert, so it is the same rule storage is already keeping.
   */
  buckets constant text[] := array[
    'avatars', 'user-uploads', 'presentation-assets', 'generated-images',
    'exports', 'thumbnails', 'game-assets', 'survey-uploads',
    'marketplace-previews', 'marketplace-files'
  ];

  v_reasons text[];
  v_keep_products uuid[];
  v_keep_games uuid[];
  v_objects jsonb;
  v_pending text[] := '{}';
  v_next text[];
  v_target text;
  v_pass integer;
  v_blocked jsonb := '[]'::jsonb;
  v_row record;
begin
  if p_user is null then
    raise exception 'purge_account_data needs a user id' using errcode = '22004';
  end if;

  v_reasons := public.account_retention_reasons(p_user);

  /**
   * Listings a paid record still points at.
   *
   * Somebody bought these. Deleting the row would break the purchase that names
   * it and take the file the buyer paid for with it, so the listing is archived
   * instead: off the shelf, unreachable from the store, still there for the
   * person holding a licence to it. Its files stay in storage for the same
   * reason — see the object query below, which skips exactly these folders.
   */
  select coalesce(array_agg(distinct product.id), '{}'::uuid[])
    into v_keep_products
    from public.marketplace_products as product
   where product.seller_id = p_user
     and (
       exists (select 1 from public.marketplace_purchases where product_id = product.id)
       or exists (select 1 from public.payment_transactions where product_id = product.id)
       or exists (select 1 from public.orders where product_id = product.id)
       or exists (select 1 from public.seller_ledger_entries where product_id = product.id)
       or exists (select 1 from public.purchase_entitlements where product_id = product.id)
     );

  -- A game sold as a listing is held by that listing (`game_id … restrict`),
  -- so it is archived rather than deleted for the same reason.
  select coalesce(array_agg(distinct product.game_id), '{}'::uuid[])
    into v_keep_games
    from public.marketplace_products as product
   where product.id = any (v_keep_products)
     and product.game_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', object.bucket_id, 'name', object.name)), '[]'::jsonb)
    into v_objects
    from storage.objects as object
   where object.bucket_id = any (buckets)
     and split_part(object.name, '/', 1) = p_user::text
     and not (
       object.bucket_id in ('marketplace-previews', 'marketplace-files')
       and split_part(object.name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
       and split_part(object.name, '/', 2)::uuid = any (v_keep_products)
     );

  update public.marketplace_products
     set status = 'archived', published_at = null, updated_at = now()
   where seller_id = p_user
     and id = any (v_keep_products)
     and status <> 'archived';

  -- Products before games: a listing holds its game with a `restrict` key, so
  -- the shelf has to be cleared before the thing on it can go.
  delete from public.marketplace_products
   where seller_id = p_user
     and not (id = any (v_keep_products));

  update public.games
     set status = 'archived', updated_at = now()
   where owner_id = p_user
     and id = any (v_keep_games)
     and status <> 'archived';

  delete from public.games
   where owner_id = p_user
     and not (id = any (v_keep_games));

  /**
   * Everything else the person owns, found in the catalogue rather than typed
   * out here.
   *
   * A hand-written list of sixty tables is a list that is wrong the first time
   * somebody adds a table and does not think of this file — and the failure is
   * silent, which is the worst kind: a deletion that quietly leaves rows
   * behind. So the tables are the ones the schema itself already marks as
   * belonging to a user: a single-column foreign key to `auth.users` declared
   * `on delete cascade`. That is the schema's own statement that these rows die
   * with the account. This just makes it happen now, and without needing the
   * `auth.users` row to be deletable.
   *
   * `on delete set null` keys are deliberately not here. A `created_by` on a
   * shared design or an `updated_by` on a setting is a mention of the person,
   * not a possession of theirs, and the schema already says what to do with it.
   */
  for v_row in
    select class_.relname::text as table_name,
           attribute.attname::text as column_name
      from pg_constraint as constraint_
      join pg_class as class_ on class_.oid = constraint_.conrelid
      join pg_attribute as attribute
        on attribute.attrelid = constraint_.conrelid
       and attribute.attnum = constraint_.conkey[1]
     where constraint_.contype = 'f'
       and constraint_.confrelid = 'auth.users'::regclass
       and constraint_.confdeltype = 'c'
       and cardinality(constraint_.conkey) = 1
       and constraint_.connamespace = 'public'::regnamespace
       and class_.relnamespace = 'public'::regnamespace
  loop
    if not (v_row.table_name = any (retained)) and not (v_row.table_name = any (handled)) then
      v_pending := v_pending || format('%s|%s', v_row.table_name, v_row.column_name);
    end if;
  end loop;

  /**
   * Repeated passes, because the order is not knowable up front.
   *
   * Owned tables reference each other, and some of those references refuse a
   * delete rather than following it. Sorting the graph would mean encoding a
   * topology that changes with every migration. Retrying is the version that
   * stays true: a table that could not go this pass goes next pass, once
   * whatever was holding it has gone. Five passes is far deeper than this
   * schema nests; anything still standing after them is reported rather than
   * raised, because a purge that has already removed a person's name should not
   * roll itself back over one stubborn row.
   */
  for v_pass in 1..5 loop
    exit when cardinality(v_pending) = 0;
    v_next := '{}';
    foreach v_target in array v_pending loop
      begin
        execute format(
          'delete from public.%I where %I = $1',
          split_part(v_target, '|', 1),
          split_part(v_target, '|', 2)
        ) using p_user;
      exception
        when foreign_key_violation or restrict_violation then
          v_next := v_next || v_target;
      end;
    end loop;
    v_pending := v_next;
  end loop;

  if cardinality(v_pending) > 0 then
    select jsonb_agg(distinct split_part(entry, '|', 1)) into v_blocked from unnest(v_pending) as entry;
  end if;

  /**
   * The profile, which is where the person actually is.
   *
   * If nothing is retained the row goes with `auth.users` a moment from now and
   * this scrub is redundant; it runs anyway, so that the state after this
   * function is the same either way and a failure between here and the auth
   * delete cannot leave a name behind. `status = 'blocked'` is what stops the
   * account being used in the window before the session is revoked — every
   * Edge Function checks it on the way in.
   */
  update public.profiles
     set full_name = '',
         first_name = '',
         last_name = '',
         username = null,
         bio = '',
         avatar_url = null,
         organization = null,
         field_of_study = null,
         status = 'blocked',
         last_seen_at = null,
         updated_at = now()
   where id = p_user;

  return jsonb_build_object(
    'user', p_user,
    'reasons', to_jsonb(v_reasons),
    'retained', cardinality(v_reasons) > 0,
    'archivedProducts', to_jsonb(v_keep_products),
    'objects', v_objects,
    'blocked', v_blocked
  );
end;
$$;

comment on function public.purge_account_data(uuid) is
  'Erases everything an account owns and reports the storage objects that go with it. Service role only.';

-- --------------------------------------------------------------- privileges --

revoke all on function public.account_retention_reasons(uuid) from public;
revoke all on function public.account_retention_reasons(uuid) from anon;
revoke all on function public.account_retention_reasons(uuid) from authenticated;
grant execute on function public.account_retention_reasons(uuid) to service_role;

revoke all on function public.purge_account_data(uuid) from public;
revoke all on function public.purge_account_data(uuid) from anon;
revoke all on function public.purge_account_data(uuid) from authenticated;
grant execute on function public.purge_account_data(uuid) to service_role;
