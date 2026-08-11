-- O‘yingoh: the presentation handoff, the admin console, and the seed subjects.
--
-- The handoff is the flagship move: slides end, the phone shows one button,
-- and the projector that was rendering a deck becomes a game lobby. The
-- mechanics reuse both capability systems as they are — the presentation
-- session proves who the host is, a brand-new game session carries its own
-- tokens, and the raw screen token travels from host to projector over the
-- private broadcast channel they already share. Nothing about presentation
-- security changes.

-- ----------------------------------------------------------------- handoff --
/**
 * Launches the game linked to the deck a presentation session is showing.
 *
 * Called by the presentation host from the remote. Returns the new game
 * session with its raw screen token — the caller hands that to the projector
 * over the presentation's private channel, and the projector calls
 * game_screen_snapshot with it from then on.
 */
create or replace function public.presentation_launch_game(
  p_presentation_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_presentation_session public.presentation_sessions%rowtype;
  v_game public.games%rowtype;
  v_session public.game_sessions%rowtype;
  v_screen text := public.presentation_new_token();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_presentation_session from public.presentation_sessions
    where id = p_presentation_session_id;
  if not found or v_presentation_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_presentation_session.presentation_id is null then
    raise exception 'Bu sessiyada taqdimot tanlanmagan.' using errcode = '22023';
  end if;

  select * into v_game from public.games
    where source_presentation_id = v_presentation_session.presentation_id
      and owner_id = v_user
      and status = 'ready'::public.game_status
    order by created_at desc
    limit 1;
  if not found then
    raise exception 'Bu taqdimotga bog‘langan tayyor o‘yin topilmadi.' using errcode = 'P0002';
  end if;

  insert into public.game_sessions (
    host_user_id, game_id, screen_token_hash, realtime_token, join_token, join_code
  ) values (
    v_user, v_game.id,
    encode(extensions.digest(v_screen, 'sha256'), 'hex'),
    public.presentation_new_token(), public.presentation_new_token(), public.game_new_join_code()
  )
  returning * into v_session;

  return jsonb_build_object(
    'game_session_id', v_session.id,
    'game_id', v_game.id,
    'game_title', v_game.title,
    'screen_token', v_screen,
    'realtime_token', v_session.realtime_token,
    'join_token', v_session.join_token,
    'join_code', v_session.join_code
  );
end;
$$;

/** Whether the remote should offer the launch button at all. */
create or replace function public.presentation_has_game(p_presentation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.games g
    where g.source_presentation_id = p_presentation_id
      and g.owner_id = auth.uid()
      and g.status = 'ready'::public.game_status
  );
$$;

-- ------------------------------------------------------------------- admin --
/**
 * The O‘yingoh dashboard in one round trip: today's numbers plus the window
 * the console asked for.
 */
create or replace function public.admin_game_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => greatest(coalesce(p_days, 7) - 1, 0));
  v_today timestamptz := date_trunc('day', now());
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'today', jsonb_build_object(
      'games_created', (select count(*) from public.games where created_at >= v_today),
      'sessions_finished', (select count(*) from public.game_sessions where status = 'finished'::public.game_session_status and ended_at >= v_today),
      'participants', (select count(*) from public.game_players where joined_at >= v_today),
      'answers', (select count(*) from public.game_answers where submitted_at >= v_today),
      'rewards_paid', coalesce((select sum(amount) from public.credit_transactions where type = 'game_reward' and created_at >= v_today), 0),
      'game_sales', (select count(*) from public.marketplace_purchases pu join public.marketplace_products pr on pr.id = pu.product_id where pr.game_id is not null and pu.purchased_at >= v_today)
    ),
    'window', jsonb_build_object(
      'days', greatest(coalesce(p_days, 7), 1),
      'games_created', (select count(*) from public.games where created_at >= v_from),
      'sessions_finished', (select count(*) from public.game_sessions where status = 'finished'::public.game_session_status and ended_at >= v_from),
      'participants', (select count(*) from public.game_players where joined_at >= v_from),
      'answers', (select count(*) from public.game_answers where submitted_at >= v_from),
      'rewards_paid', coalesce((select sum(amount) from public.credit_transactions where type = 'game_reward' and created_at >= v_from), 0),
      'game_sales', (select count(*) from public.marketplace_purchases pu join public.marketplace_products pr on pr.id = pu.product_id where pr.game_id is not null and pu.purchased_at >= v_from),
      'ai_cost_usd', coalesce((select round(sum(provider_cost_usd), 4) from public.ai_usage where operation like 'game%' and created_at >= v_from), 0)
    ),
    'live_sessions', (select count(*) from public.game_sessions
      where status not in ('finished'::public.game_session_status,
                           'cancelled'::public.game_session_status,
                           'expired'::public.game_session_status)
        and expires_at > now())
  );
end;
$$;

create or replace function public.admin_list_games(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null
)
returns table (
  id uuid,
  title text,
  owner_email text,
  category_label text,
  status public.game_status,
  source_type public.game_source,
  is_free boolean,
  featured boolean,
  question_count integer,
  sessions_count integer,
  marketplace_status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
    select g.id, g.title, u.email::text, c.label,
           g.status, g.source_type, g.is_free, g.featured_at is not null,
           g.question_count, g.sessions_count,
           (select p.status::text from public.marketplace_products p where p.game_id = g.id order by p.created_at desc limit 1),
           g.created_at
    from public.games g
    left join auth.users u on u.id = g.owner_id
    left join public.game_categories c on c.id = g.category_id
    where p_search is null or p_search = ''
       or g.title ilike '%' || p_search || '%'
       or u.email ilike '%' || p_search || '%'
    order by g.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

/**
 * Moderation verbs: hide (archive), restore (back to ready), free / unfree,
 * feature / unfeature. Every one lands in the audit log.
 */
create or replace function public.admin_moderate_game(
  p_game_id uuid,
  p_action text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_game public.games%rowtype;
  v_before jsonb;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'game not found' using errcode = 'P0002'; end if;
  v_before := to_jsonb(v_game);

  case p_action
    when 'hide' then
      update public.games set status = 'archived'::public.game_status, is_free = false, featured_at = null
        where id = p_game_id returning * into v_game;
    when 'restore' then
      update public.games set status = 'ready'::public.game_status
        where id = p_game_id returning * into v_game;
    when 'set_free' then
      if v_game.status <> 'ready'::public.game_status then
        raise exception 'only a ready game can be free' using errcode = '22023';
      end if;
      update public.games set is_free = true where id = p_game_id returning * into v_game;
    when 'unset_free' then
      update public.games set is_free = false, featured_at = null where id = p_game_id returning * into v_game;
    when 'feature' then
      if v_game.status <> 'ready'::public.game_status or not v_game.is_free then
        raise exception 'only a free, ready game can be featured' using errcode = '22023';
      end if;
      update public.games set featured_at = now() where id = p_game_id returning * into v_game;
    when 'unfeature' then
      update public.games set featured_at = null where id = p_game_id returning * into v_game;
    else
      raise exception 'unknown action %', p_action using errcode = '22023';
  end case;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'game.' || p_action, 'game', p_game_id::text, v_before, to_jsonb(v_game),
          left(btrim(coalesce(p_reason, '')), 500));

  return jsonb_build_object('id', v_game.id, 'status', v_game.status, 'is_free', v_game.is_free,
                            'featured', v_game.featured_at is not null);
end;
$$;

create or replace function public.admin_list_game_sessions(p_live_only boolean default true)
returns table (
  id uuid,
  game_title text,
  host_email text,
  status public.game_session_status,
  player_count integer,
  current_index integer,
  question_count integer,
  reward_reserved integer,
  started_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
    select s.id, coalesce(g.title, '—'), u.email::text, s.status, s.player_count,
           s.current_index, coalesce(array_length(s.question_ids, 1), 0),
           s.reward_reserved, s.started_at, s.created_at
    from public.game_sessions s
    left join public.games g on g.id = s.game_id
    left join auth.users u on u.id = s.host_user_id
    where not p_live_only
       or (s.status not in ('finished'::public.game_session_status,
                            'cancelled'::public.game_session_status,
                            'expired'::public.game_session_status)
           and s.expires_at > now())
    order by s.created_at desc
    limit 100;
end;
$$;

/** The emergency stop. Refunds the hold, cancels the match, writes why. */
create or replace function public.admin_terminate_game_session(
  p_session_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_session public.game_sessions%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required to terminate a live session' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.status in ('finished'::public.game_session_status,
                          'cancelled'::public.game_session_status,
                          'expired'::public.game_session_status) then
    return false;
  end if;

  perform public.game_rewards_refund(p_session_id);
  update public.game_sessions set
    status = 'cancelled'::public.game_session_status,
    ended_at = now(), phase_deadline = null,
    state_version = state_version + 1
    where id = p_session_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, reason)
  values (v_admin, 'game_session.terminate', 'game_session', p_session_id::text,
          to_jsonb(v_session), left(btrim(p_reason), 500));
  return true;
end;
$$;

-- p_id defaults to null so creating a category is a call that simply omits it,
-- rather than one that has to name a uuid column as null.
create or replace function public.admin_save_game_category(
  p_code text,
  p_label text,
  p_id uuid default null,
  p_parent_id uuid default null,
  p_icon text default '',
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.game_categories%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.game_categories (code, label, parent_id, icon, sort_order, is_active)
    values (btrim(p_code), btrim(p_label), p_parent_id, btrim(coalesce(p_icon, '')), coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning * into v_row;
  else
    update public.game_categories set
      code = btrim(p_code), label = btrim(p_label), parent_id = p_parent_id,
      icon = btrim(coalesce(p_icon, '')), sort_order = coalesce(p_sort_order, 0),
      is_active = coalesce(p_is_active, true)
      where id = p_id returning * into v_row;
    if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'game_category.save', 'game_category', v_row.id::text, to_jsonb(v_row));
  return v_row.id;
end;
$$;

create or replace function public.admin_delete_game_category(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_row public.game_categories%rowtype;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  delete from public.game_categories where id = p_id returning * into v_row;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data)
  values (v_admin, 'game_category.delete', 'game_category', p_id::text, to_jsonb(v_row));
  return true;
end;
$$;

-- ------------------------------------------------------------------- seeds --
-- The subject shelf the home screen opens with. Admins reshape it at will.
insert into public.game_categories (code, label, icon, sort_order) values
  ('maktab', 'Maktab', 'school', 10),
  ('universitet', 'Universitet', 'graduation-cap', 20),
  ('umumiy_bilim', 'Umumiy bilim', 'lightbulb', 30),
  ('tillar', 'Tillar', 'languages', 40),
  ('tarix', 'Tarix', 'landmark', 50),
  ('it', 'IT', 'monitor', 60),
  ('matematika', 'Matematika', 'calculator', 70),
  ('adabiyot', 'Adabiyot', 'book-open', 80),
  ('geografiya', 'Geografiya', 'globe', 90),
  ('biologiya', 'Biologiya', 'leaf', 100),
  ('kimyo', 'Kimyo', 'flask-conical', 110),
  ('fizika', 'Fizika', 'atom', 120),
  ('iqtisod', 'Iqtisod', 'trending-up', 130),
  ('huquq', 'Huquq', 'scale', 140),
  ('biznes', 'Biznes', 'briefcase', 150),
  ('boshqa', 'Boshqa', 'shapes', 900)
on conflict (code) do nothing;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.presentation_launch_game(uuid)',
    'public.presentation_has_game(uuid)',
    'public.admin_game_overview(integer)',
    'public.admin_list_games(integer, integer, text)',
    'public.admin_moderate_game(uuid, text, text)',
    'public.admin_list_game_sessions(boolean)',
    'public.admin_terminate_game_session(uuid, text)',
    'public.admin_save_game_category(text, text, uuid, uuid, text, integer, boolean)',
    'public.admin_delete_game_category(uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
