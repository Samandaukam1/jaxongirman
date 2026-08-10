-- Teaches every server-side privilege check about super_admin.
--
-- is_admin() only ever matched the literal 'admin', so a super_admin — the
-- higher tier — failed all 35 checks that funnel through it, including every
-- admin RPC and every RLS policy on the console's tables. Widening this one
-- function fixes all of them at once; no call site changes.

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id
      and role in ('admin'::public.app_role, 'super_admin'::public.app_role)
  );
$$;

comment on function public.is_admin(uuid) is
  'True for admin and super_admin. Gate for the admin console and every admin RPC.';

-- The reserved tier: operations that change who holds power, or what the
-- platform charges, are meant to sit behind this rather than behind is_admin().
create or replace function public.is_super_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'super_admin'::public.app_role
  );
$$;

comment on function public.is_super_admin(uuid) is
  'True only for super_admin. Reserved for role management and platform-wide settings.';

/**
 * The caller's strongest role. The console needs this to decide which controls
 * to render; is_admin() alone cannot distinguish the two admin tiers. Returns
 * 'user' for anyone signed in without a role, so the client never has to treat
 * null as a special case.
 */
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select role
      from public.user_roles
      where user_id = auth.uid()
      order by case role
        when 'super_admin'::public.app_role then 2
        when 'admin'::public.app_role then 1
        else 0
      end desc
      limit 1
    ),
    'user'::public.app_role
  );
$$;

comment on function public.current_app_role() is
  'The signed-in account''s highest role, for rendering decisions only — never as the sole gate on a privileged action.';

revoke all on function public.is_super_admin(uuid) from public;
revoke all on function public.is_super_admin(uuid) from anon;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.is_super_admin(uuid) to service_role;

revoke all on function public.current_app_role() from public;
revoke all on function public.current_app_role() from anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_app_role() to service_role;
