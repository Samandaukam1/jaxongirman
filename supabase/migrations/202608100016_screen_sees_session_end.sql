-- Letting the projector find out that the talk is over.
--
-- The screen follows its own row through Realtime, and Realtime applies the
-- same row policy to every change it delivers. The policy admitted `pairing`
-- and `active` only, so the one update that matters most — the phone pressing
-- "yakunlash", which sets `ended` — moved the row out of what the screen is
-- allowed to see. Realtime therefore dropped it, and the projector went on
-- showing the last slide of a finished talk with no way to learn otherwise.
--
-- `ended` is added to the policy. The rows reachable this way are still the
-- thin ones: `anon` holds column grants for a slide number, a zoom level and a
-- status, and none for `host_user_id` or `presentation_id`, so a finished
-- session says nothing about who gave the talk. `expires_at` still bounds it,
-- so an ended session stops being visible on the same schedule as any other.

drop policy if exists presentation_sessions_screen_select on public.presentation_sessions;

create policy presentation_sessions_screen_select on public.presentation_sessions for select to anon
  using (
    status in (
      'pairing'::public.presentation_session_status,
      'active'::public.presentation_session_status,
      'ended'::public.presentation_session_status
    )
    and expires_at > now()
  );
