-- Hosted Supabase grants table privileges to anon through default privileges,
-- which `grant ... to authenticated` does not take away. RLS already returns no
-- rows to a signed-out caller, so nothing was exposed — but the inbox should be
-- unreachable rather than merely empty, the same way the RPCs are.

revoke all on public.notifications from anon;
