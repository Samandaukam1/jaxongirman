-- Every argument optional, so a console can send what it has.
--
-- `p_id` and `p_title` were required, which made "create a campaign" a call
-- that had to pass an explicit null id — and made the generated client type say
-- the id is a string when the whole point of it is that it may be absent. The
-- title is still required; it is now checked rather than declared, which is
-- where the check belongs anyway: an empty string satisfied the old signature
-- perfectly well.
--
-- The rest of the function is unchanged from `202609011100`.

create or replace function public.admin_save_marathon_campaign(
  p_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_rules text default null,
  p_poster_path text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_contract_cap bigint default null,
  p_min_free_price integer default null,
  p_min_premium_price integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.marathon_campaigns%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'Kampaniya nomi bo''sh bo''lmasin.' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_row from public.marathon_campaigns where id = p_id for update;
    if not found then
      raise exception 'Kampaniya topilmadi.' using errcode = 'P0002';
    end if;
  end if;

  if v_row.id is null then
    insert into public.marathon_campaigns (
      title, description, rules, poster_path, status,
      starts_at, ends_at, contract_cap, min_free_price, min_premium_price
    ) values (
      btrim(p_title), coalesce(p_description, ''), coalesce(p_rules, ''), p_poster_path, 'draft',
      coalesce(p_starts_at, now()), coalesce(p_ends_at, now() + interval '30 days'),
      coalesce(p_contract_cap, 10000000),
      coalesce(p_min_free_price, 5000), coalesce(p_min_premium_price, 15000)
    )
    returning * into v_row;
  elsif v_row.status = 'draft' then
    update public.marathon_campaigns set
      title = btrim(p_title),
      description = coalesce(p_description, description),
      rules = coalesce(p_rules, rules),
      poster_path = coalesce(p_poster_path, poster_path),
      starts_at = coalesce(p_starts_at, starts_at),
      ends_at = coalesce(p_ends_at, ends_at),
      contract_cap = coalesce(p_contract_cap, contract_cap),
      min_free_price = coalesce(p_min_free_price, min_free_price),
      min_premium_price = coalesce(p_min_premium_price, min_premium_price)
      where id = v_row.id
    returning * into v_row;
  else
    -- Running or finished: only the words and the picture.
    update public.marathon_campaigns set
      title = btrim(p_title),
      description = coalesce(p_description, description),
      rules = coalesce(p_rules, rules),
      poster_path = coalesce(p_poster_path, poster_path)
      where id = v_row.id
    returning * into v_row;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_actor, 'marathon.campaign_saved', 'marathon_campaigns', v_row.id::text,
          jsonb_build_object('title', v_row.title, 'status', v_row.status));

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_save_marathon_campaign(uuid, text, text, text, text, timestamptz, timestamptz, bigint, integer, integer) from public;
grant execute on function public.admin_save_marathon_campaign(uuid, text, text, text, text, timestamptz, timestamptz, bigint, integer, integer) to authenticated;
