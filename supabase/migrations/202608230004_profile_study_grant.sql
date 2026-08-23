/**
 * The two new profile columns are writable by the person they describe.
 *
 * `profiles` is granted column by column rather than wholesale — which is right,
 * and is why adding a column is only half of adding a field. Without this the
 * update carrying `organization` fails on permission, and the failure names the
 * table rather than the column, so it reads as "you may not edit your profile".
 *
 * Everything else about who may write stays with `profiles_update_own`. This
 * only widens which columns that policy is allowed to be about.
 */

grant update (
  full_name, avatar_url, last_seen_at, first_name, last_name, username, bio,
  organization, field_of_study
) on public.profiles to authenticated;
