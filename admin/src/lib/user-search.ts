import type { Database } from "@jaxongirman/types";

import { supabase } from "@/lib/supabase";

export type AdminUserRow = Database["public"]["Functions"]["admin_list_users"]["Returns"][number];

/** admin_list_users never returns more than this many rows per call. */
const PAGE = 100;
/** How far the fallback pages before giving up on one person: 3 000 accounts. */
const MAX_PAGES = 30;
/** Handles that contain what was typed, of which this many are brought in. */
const MAX_HANDLE_MATCHES = 10;

/**
 * The admin user list, found by email, name — or username.
 *
 * `admin_list_users` in production matches email and name only; it was written
 * before profiles had a username (202611170001 teaches it handles, but is not
 * applied yet). Until it is, the console finds handles itself: an admin may
 * read every profile, so the handle is looked up there, and that person's full
 * row — balance, email, decks — is then fetched through the same function by
 * their name and picked out by id. With the migration applied, the person is
 * already in the first answer and nothing extra is asked.
 *
 * Every row also carries its username, read from profiles when the function
 * did not send one, so the list can show whom it found.
 */
export async function listAdminUsers(search: string, limit: number): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_users", { p_search: search || undefined, p_limit: limit, p_offset: 0 });
  if (error) throw error;
  let rows = data ?? [];
  // The handle lookup only ever adds to the list; if it fails, the list the
  // function gave is still the answer.
  const handle = asHandle(search);
  if (handle) rows = await withHandleMatches(handle, rows).catch(() => rows);
  return withUsernames(rows).catch(() => rows);
}

/** What was typed, as a handle: "@Ali_V" → "ali_v". Null when it cannot be one (spaces, dots, "@" inside). */
export function asHandle(search: string): string | null {
  const handle = search.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_]{2,24}$/.test(handle) ? handle : null;
}

/** Exact handle first, then handles that start with it, then the shortest. */
export function rankHandles<T extends { username: string }>(handle: string, people: T[]): T[] {
  const rank = (name: string) => (name === handle ? 0 : name.startsWith(handle) ? 1 : 2);
  return people
    .filter((person) => person.username.includes(handle))
    .sort((a, b) => rank(a.username) - rank(b.username) || a.username.length - b.username.length || a.username.localeCompare(b.username));
}

async function withHandleMatches(handle: string, rows: AdminUserRow[]): Promise<AdminUserRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .ilike("username", `%${handle}%`)
    .limit(50);
  if (error) throw error;
  // `_` is a wildcard to LIKE; `includes` keeps only real matches.
  const people = rankHandles(
    handle,
    (data ?? []).flatMap((p) => (p.username ? [{ id: p.id, full_name: p.full_name, username: p.username.toLowerCase() }] : [])),
  ).slice(0, MAX_HANDLE_MATCHES);
  if (!people.length) return rows;

  const known = new Map(rows.map((row) => [row.user_id, row]));
  const found = await Promise.all(people.map(async (person) => {
    const row = known.get(person.id) ?? await findRow(person.id, person.full_name?.trim() ?? "");
    return row ? { ...row, username: person.username } : null;
  }));
  const first = found.filter((row): row is AdminUserRow => row !== null);
  const ids = new Set(first.map((row) => row.user_id));
  return [...first, ...rows.filter((row) => !ids.has(row.user_id))];
}

/** One person's row, through the list function: by their name when they have one, else through everyone. */
async function findRow(id: string, name: string): Promise<AdminUserRow | null> {
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("admin_list_users", { p_search: name || undefined, p_limit: PAGE, p_offset: page * PAGE });
    if (error) throw error;
    const hit = data?.find((row) => row.user_id === id);
    if (hit) return hit;
    if (!data || data.length < PAGE) return null;
  }
  return null;
}

async function withUsernames(rows: AdminUserRow[]): Promise<AdminUserRow[]> {
  const missing = rows.filter((row) => !row.username).map((row) => row.user_id);
  if (!missing.length) return rows;
  const { data, error } = await supabase.from("profiles").select("id, username").in("id", missing);
  if (error) throw error;
  const handles = new Map((data ?? []).map((p) => [p.id, p.username ?? ""]));
  return rows.map((row) => (row.username ? row : { ...row, username: handles.get(row.user_id) ?? "" }));
}
