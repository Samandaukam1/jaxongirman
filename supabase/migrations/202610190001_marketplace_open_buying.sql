-- Buying from the shop no longer needs a tariff; selling still does.
--
-- 202608160005 made the marketplace a members' economy on both sides. The
-- product decision since: anyone signed in may buy, because a buyer with no
-- plan is still a buyer, while listing material for sale stays a plan feature
-- (`marketplace_access` + `marketplace_sell`), exactly as before.
--
-- The guard keeps its name and signature, so the two callers on the buying
-- side — `order_create_marketplace` and `marketplace_create_checkout` — change
-- nothing: their `assert_marketplace_member('buy')` now only asks that somebody
-- is signed in. What a purchase unlocks (download, presenting, hosting a bought
-- game) was never tied to a plan, so a buyer without one gets all of it.
-- The iOS payment switch is a separate check and is untouched.

create or replace function public.assert_marketplace_member(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ent jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if lower(coalesce(p_action, '')) <> 'sell' then
    return;
  end if;

  v_ent := public.my_entitlements(auth.uid());

  -- Worded for the one thing that is still refused: a buyer must never read
  -- that the shop as a whole is closed to them.
  if coalesce((v_ent ->> 'member')::boolean, false) is not true then
    raise exception 'Do‘konda sotish uchun tarifni faollashtiring.'
      using errcode = '42501', detail = 'subscription_required';
  end if;

  if coalesce((v_ent -> 'features' -> 'marketplace_access' ->> 'enabled')::boolean, false) is not true
     or coalesce((v_ent -> 'features' -> 'marketplace_sell' ->> 'enabled')::boolean, false) is not true then
    raise exception 'Tarifingizda bu amal mavjud emas.'
      using errcode = '42501', detail = 'not_entitled';
  end if;
end;
$$;

revoke all on function public.assert_marketplace_member(text) from public, anon;
grant execute on function public.assert_marketplace_member(text) to authenticated;
