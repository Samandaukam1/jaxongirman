-- Promotes the platform owner to super_admin.
--
-- The select finds nothing on a database where this account does not exist, so
-- a fresh local reset stays quiet instead of failing, and `on conflict` makes a
-- repeat run a no-op. A person may hold both admin and super_admin rows;
-- current_app_role() reports the stronger of the two.

insert into public.user_roles (user_id, role, granted_by)
select id, 'super_admin'::public.app_role, id
from auth.users
where id = '101902a5-cc9c-43ea-b025-b2a18fa572f5'
on conflict (user_id, role) do nothing;
