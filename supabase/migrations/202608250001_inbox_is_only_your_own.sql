-- An inbox is one person's, and an admin is a person too.
--
-- `notifications_select_own` read `user_id = auth.uid() or is_admin()`, which
-- meant an account with the admin role opened the app and saw every message the
-- system had ever sent anyone — in the list, and in the unread count on the bell.
-- That is not an admin tool. It is somebody else's post, delivered to the wrong
-- door, and the people whose messages those are never agreed to it.
--
-- Nothing reads this table on an admin's behalf: the console does not query it,
-- and the edge functions that write notifications use the service role, which
-- does not consult policies at all. So the clause bought nothing and cost
-- everything, and it goes.
--
-- Support genuinely needing to see somebody's inbox should get a function that
-- takes the person's id, logs who asked, and returns that one inbox — not a
-- policy that quietly widens every ordinary query an admin makes.

drop policy if exists notifications_select_own on public.notifications;

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
