/**
 * The admin's user search finds people by username.
 *
 * `admin_list_users` was written before profiles had a username, so it matched
 * email and name only — and "Tanga sovg‘a qilish" and "Foydalanuvchilar" both
 * promise "username orqali qidirish". Typing a handle found nobody.
 *
 * Now a handle is matched as the app writes it, with or without the "@", and
 * the person whose handle (or email) is exactly what was typed comes first, so
 * they are on the first screen however many other handles contain the same
 * letters. `_` and `%` in what was typed are letters, not wildcards: "ali_v"
 * does not also find "alixv".
 *
 * The username is returned as well, so the console can show whom it found. The
 * column is added last; the return type changes, which is why this drops and
 * recreates rather than replacing.
 */

drop function if exists public.admin_list_users(text, integer, integer);

create function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  status public.user_status,
  credits integer,
  reserved_credits integer,
  presentation_count bigint,
  created_at timestamptz,
  last_seen_at timestamptz,
  username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  -- "@ali" is how a handle is written everywhere in the app, so it is typed that way too.
  v_handle text := lower(regexp_replace(coalesce(v_term, ''), '^@+', ''));
  v_term_like text;
  v_handle_like text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin role required' using errcode = '42501'; end if;

  v_term_like := replace(replace(replace(coalesce(v_term, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_handle_like := replace(replace(replace(v_handle, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select u.id, u.email::text, p.full_name, p.status, w.balance, w.reserved,
    count(pr.id), u.created_at, p.last_seen_at, p.username
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.credit_wallets w on w.user_id = u.id
  left join public.presentations pr on pr.owner_id = u.id
  where v_term is null
     or u.email ilike '%' || v_term_like || '%'
     or p.full_name ilike '%' || v_term_like || '%'
     or (v_handle <> '' and lower(p.username) like '%' || v_handle_like || '%')
  group by u.id, u.email, p.full_name, p.status, w.balance, w.reserved, u.created_at, p.last_seen_at, p.username
  order by
    -- coalesce: a null sorts first under DESC, and a person with no username
    -- must not outrank the one whose username was typed.
    coalesce(v_handle <> '' and lower(p.username) = v_handle, false) desc,
    coalesce(lower(u.email::text) = lower(v_term), false) desc,
    coalesce(v_handle <> '' and lower(p.username) like v_handle_like || '%', false) desc,
    u.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

comment on function public.admin_list_users(text, integer, integer) is
  'Admin user list. p_search matches email, name or username ("@" optional); an exact username or email comes first.';

revoke all on function public.admin_list_users(text, integer, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
