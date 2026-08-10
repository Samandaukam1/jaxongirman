-- Making the column grant on `presentation_sessions` the thing that decides.
--
-- 202608100010 granted `anon` six columns and no more, and on a database built
-- by `supabase db reset` that is exactly what it got: the local default
-- privileges hand out no table-wide SELECT, so the column list was the only
-- grant there was.
--
-- A hosted project is built differently. Its default privileges do include a
-- table-wide SELECT for `anon`, so the same migration produced a table grant
-- *plus* a redundant column list — and a table grant covers every column. The
-- restriction was real locally, passed its test locally, and was not in effect
-- where it mattered.
--
-- So the table grant is withdrawn first and the columns granted after. Revoking
-- SELECT on a table drops its column grants too, which is why the order matters
-- and why this is safe to run twice.
--
-- Row-level security was never in question here: the policy already limits the
-- rows to live sessions, and no data was reachable that a policy would have
-- stopped. What was reachable was `host_user_id` — who is presenting — on any
-- session currently on a screen.

revoke select on public.presentation_sessions from anon;
grant select (id, status, current_slide, slide_count, zoom, expires_at)
  on public.presentation_sessions to anon;
