-- Adds the super_admin tier to app_role.
--
-- The hosted database already carries this value; it was added by hand and the
-- migration history never caught up, so a fresh local database disagreed with
-- production. Adding it conditionally puts the two back in step without failing
-- where it already exists.
--
-- Nothing may *use* the new label in this file: Postgres refuses to reference an
-- enum value in the same transaction that adds it, so is_admin() is rewritten in
-- the migration that follows.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role' and e.enumlabel = 'super_admin'
  ) then
    alter type public.app_role add value 'super_admin';
  end if;
end
$$;
