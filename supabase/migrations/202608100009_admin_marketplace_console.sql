-- What the admin console needs to run the marketplace.
--
-- Listing goes through an RPC rather than a plain select because a moderator
-- works from the seller's email, and PostgREST cannot reach auth.users. The
-- resolve function exists because `marketplace_reports` deliberately has no
-- admin UPDATE policy: closing a complaint is an audited action, not a row edit.

/** The moderation queue and the full catalogue, with the seller's identity. */
create or replace function public.admin_list_marketplace_products(
  p_status public.marketplace_product_status default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  status public.marketplace_product_status,
  material_type text,
  base_price integer,
  currency text,
  sales_count integer,
  rating numeric,
  rating_count integer,
  seller_id uuid,
  seller_email text,
  seller_name text,
  has_main_file boolean,
  open_reports bigint,
  rejection_reason text,
  created_at timestamptz,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.title, p.status, p.material_type, p.base_price, p.currency, p.sales_count,
    case when p.rating_count = 0 then null else round(p.rating_sum::numeric / p.rating_count, 2) end,
    p.rating_count, p.seller_id, u.email::text, pr.full_name,
    exists (
      select 1 from public.marketplace_product_files f
      where f.product_id = p.id and f.kind = 'main'::public.marketplace_file_kind
    ),
    (select count(*) from public.marketplace_reports r
     where r.product_id = p.id
       and r.status in ('open'::public.marketplace_report_status, 'reviewing'::public.marketplace_report_status)),
    p.rejection_reason, p.created_at, p.published_at
  from public.marketplace_products p
  join auth.users u on u.id = p.seller_id
  join public.profiles pr on pr.id = p.seller_id
  where (p_status is null or p.status = p_status)
    and (
      nullif(btrim(p_search), '') is null
      or p.title ilike '%' || btrim(p_search) || '%'
      or u.email ilike '%' || btrim(p_search) || '%'
    )
  -- Oldest first when reviewing: a queue is fair only if it is a queue.
  order by case when p_status = 'pending_review'::public.marketplace_product_status then p.created_at end asc,
           p.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

/** Complaints awaiting a decision, with who reported what. */
create or replace function public.admin_list_marketplace_reports(
  p_status public.marketplace_report_status default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  product_id uuid,
  product_title text,
  seller_email text,
  reporter_email text,
  reason public.marketplace_report_reason,
  detail text,
  status public.marketplace_report_status,
  resolution_note text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select r.id, r.product_id, p.title, seller.email::text, reporter.email::text,
    r.reason, r.detail, r.status, r.resolution_note, r.created_at, r.resolved_at
  from public.marketplace_reports r
  join public.marketplace_products p on p.id = r.product_id
  join auth.users seller on seller.id = p.seller_id
  join auth.users reporter on reporter.id = r.reporter_id
  where (p_status is null or r.status = p_status)
  order by r.created_at asc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

/** Closes a complaint. Upholding one hides the product in the same transaction. */
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status public.marketplace_report_status,
  p_note text default ''
)
returns public.marketplace_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before public.marketplace_reports%rowtype;
  v_after public.marketplace_reports%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_status = 'open'::public.marketplace_report_status then
    raise exception 'a complaint cannot be reopened' using errcode = '22023';
  end if;

  select * into v_before from public.marketplace_reports where id = p_report_id for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;

  update public.marketplace_reports set
    status = p_status,
    resolution_note = left(btrim(coalesce(p_note, '')), 1000),
    resolved_by = v_admin,
    resolved_at = case when p_status = 'reviewing'::public.marketplace_report_status then null else now() end
    where id = p_report_id
    returning * into v_after;

  -- An upheld complaint is only meaningful if the listing comes down with it.
  if p_status = 'upheld'::public.marketplace_report_status then
    perform public.admin_moderate_product(
      v_before.product_id, 'hide',
      left('Shikoyat asosida yashirildi: ' || coalesce(nullif(btrim(p_note), ''), v_before.reason::text), 500)
    );
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'marketplace.report_resolved', 'marketplace_report', p_report_id::text,
          jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status),
          left(btrim(coalesce(p_note, '')), 500));

  return v_after;
end;
$$;

/** Sellers with money waiting, so a payout run is one click rather than a hunt. */
create or replace function public.admin_pending_payouts()
returns table (
  seller_id uuid,
  seller_email text,
  seller_name text,
  phone text,
  telegram_username text,
  sales_count bigint,
  payable_amount bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select l.seller_id, u.email::text, pr.full_name, c.phone, c.telegram_username,
    count(*), coalesce(sum(l.net_amount), 0)
  from public.seller_ledger_entries l
  join auth.users u on u.id = l.seller_id
  join public.profiles pr on pr.id = l.seller_id
  left join public.seller_payout_contacts c on c.user_id = l.seller_id
  where l.settlement_id is null
    and not l.is_sandbox
    and l.status in ('pending'::public.seller_ledger_status, 'approved'::public.seller_ledger_status)
  group by l.seller_id, u.email, pr.full_name, c.phone, c.telegram_username
  order by sum(l.net_amount) desc;
end;
$$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_list_marketplace_products(public.marketplace_product_status, text, integer, integer)',
    'public.admin_list_marketplace_reports(public.marketplace_report_status, integer)',
    'public.admin_resolve_report(uuid, public.marketplace_report_status, text)',
    'public.admin_pending_payouts()'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
