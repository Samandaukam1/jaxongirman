-- Taking back two privileges nobody ever granted on purpose.
--
-- Both come from defaults rather than from a decision, which is why neither
-- shows up when you read the migrations: they are what Postgres and the
-- Supabase template hand out when a migration does not say otherwise.
--
--   1. `TRUNCATE` on every table, to `anon` and `authenticated`. Row-level
--      security does not apply to TRUNCATE — there are no rows to filter, only
--      a table to empty — so every policy in this schema is silent about it. A
--      signed-out caller holding this privilege can empty `presentations` and
--      cascade through slides, assets and jobs. PostgREST exposes no verb that
--      issues it, so this is not reachable with an API key today; it is a live
--      privilege guarded only by the absence of a way to ask, which is not a
--      guard.
--
--   2. `EXECUTE` to PUBLIC on functions. Postgres grants it at CREATE time, and
--      a later `grant execute ... to authenticated` adds to it rather than
--      replacing it. Every admin function checks `is_admin()` and refuses — the
--      audit confirmed each one — so nothing was reachable through it. But the
--      grant says the opposite of what the code means, and the next function
--      written without an internal check would inherit a caller list of
--      everyone.

-- ------------------------------------------------------------------ tables --
revoke truncate, trigger on all tables in schema public from anon, authenticated;

-- The same defaults would re-grant it to the next table created, so the rule
-- itself is changed rather than only its results so far.
alter default privileges for role postgres in schema public
  revoke truncate, trigger on tables from anon, authenticated;

do $$
begin
  -- MAINTAIN arrived in PostgreSQL 17 and carries VACUUM FULL, which takes an
  -- exclusive lock; the guard keeps this migration runnable on 15 and 16.
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end
$$;

-- --------------------------------------------------------------- functions --
/**
 * Drops the leftover PUBLIC grant wherever a real caller list already exists.
 *
 * The condition is the point: a function whose author wrote
 * `grant execute ... to authenticated` has already said who may call it, so
 * PUBLIC is the part nobody chose. Functions with no explicit grant are left
 * alone — those are the trigger helpers, which are invoked by the trigger
 * machinery rather than by a caller, and revoking from them would be a change
 * with no security to show for it.
 *
 * Functions that genuinely serve signed-out callers — a projector opening a
 * pairing session — hold an explicit `anon` grant and keep it.
 */
do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'
      )
  loop
    execute format('revoke execute on function %s from public', v_signature);
  end loop;
end
$$;
