\set ON_ERROR_STOP on

insert into public.user_roles (user_id, role, granted_by)
select id, 'admin'::public.app_role, id
from auth.users
where lower(email) = lower(:'email')
on conflict (user_id, role) do nothing;

select user_id, role, created_at
from public.user_roles
where role = 'admin'
  and user_id = (select id from auth.users where lower(email) = lower(:'email'));
