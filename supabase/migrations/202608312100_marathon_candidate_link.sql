-- Who a share link points at.
--
-- A candidate's QR carries `/marathon/<campaign>/<candidate>`, and two very
-- different readers need to resolve it: the app, to open the vote sheet on the
-- right person, and the web landing page, which nobody is signed in to. So it
-- is granted to `anon` as well — and answers with exactly what the poster the
-- link was printed on already says: a name, a picture, and which campaign it
-- belongs to. No vote counts, no e-mail, nothing about who voted.
--
-- Null for anything stale: a finished campaign, a candidate who never entered,
-- the marathon switched off. The landing page turns that into "havola eskirgan"
-- rather than a blank card.

create or replace function public.marathon_candidate(p_campaign_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'campaign_id', c.id,
    'campaign_title', c.title,
    'poster_path', c.poster_path,
    'ends_at', c.ends_at,
    'server_now', now()
  )
    from public.marathon_campaigns c
    join public.marathon_participants m on m.campaign_id = c.id and m.user_id = p_user_id
    join public.profiles p on p.id = m.user_id
   where c.id = p_campaign_id
     and c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and coalesce((select value = 'true'::jsonb from public.app_settings
                    where key = 'student_marathon_enabled'), false)
   limit 1;
$$;

revoke all on function public.marathon_candidate(uuid, uuid) from public;
grant execute on function public.marathon_candidate(uuid, uuid) to anon, authenticated;
