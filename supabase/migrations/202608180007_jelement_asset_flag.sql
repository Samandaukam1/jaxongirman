-- The setter learns the flag.
--
-- `admin_set_jelement_asset` is what the console calls when it attaches a
-- picture, and the flag arrives with the manifest at the same moment. Passing
-- it separately would mean a second call that can fail on its own, leaving an
-- element with a picture and the wrong answer about whether it may be
-- recoloured.

create or replace function public.admin_set_jelement_asset(
  p_element_id uuid,
  p_asset_path text,
  p_accent_hue numeric default null,
  p_variants jsonb default '{}'::jsonb,
  p_aspect_ratio numeric default null,
  p_recolorable boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.jelements
     set asset_path = p_asset_path,
         asset_accent_hue = p_accent_hue,
         asset_variants = coalesce(p_variants, '{}'::jsonb),
         asset_recolorable = coalesce(p_recolorable, true),
         geometry = case
           when p_aspect_ratio is null or p_aspect_ratio <= 0 then geometry
           else jsonb_set(geometry, '{aspectRatio}', to_jsonb(p_aspect_ratio))
         end,
         updated_at = now()
   where id = p_element_id;

  if not found then
    raise exception 'element not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_jelement_asset(uuid, text, numeric, jsonb, numeric, boolean) from public, anon;
grant execute on function public.admin_set_jelement_asset(uuid, text, numeric, jsonb, numeric, boolean) to authenticated;

-- The five-argument form is gone: every caller passes the flag now, and leaving
-- an overload behind means half the callers silently reset it to true.
drop function if exists public.admin_set_jelement_asset(uuid, text, numeric, jsonb, numeric);
