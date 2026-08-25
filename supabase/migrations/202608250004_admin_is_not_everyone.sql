/**
 * An administrator using the ordinary app should see their own things.
 *
 * Four select policies end in `or is_admin()`. The intent was to let the
 * console read the table; the effect is that an account with the admin role
 * opening the *phone app* gets every row in it. Loyihalar listed every deck in
 * the product mixed in with their own, sorted by date. O‘yingoh listed
 * everyone's games. The wallet and the purchase library did the same.
 *
 * It also broke a feature outright. `request_export` checks ownership properly,
 * so a PDF of the deck at the top of that list — somebody else's — came back as
 * "ready presentation not found", and the export button looked broken to the one
 * person who could not use it.
 *
 * The clause is not needed for what it was written for. The console does not
 * query any of these tables directly: it goes through `admin_list_presentations`
 * and friends, which are `security definer`, check `is_admin()` themselves and
 * never consult a policy. The functions that write these rows use the service
 * role, which does not either. So the clause bought the console nothing and
 * cost every administrator their own app.
 *
 * `orders` keeps its clause: the console does read that table directly.
 *
 * The app also names the owner in each of these queries now. Two layers on
 * purpose — a policy is the floor, and a query that says whose list it wants
 * cannot be widened by a policy edit made for some other reason.
 */

drop policy if exists presentations_select on public.presentations;
create policy presentations_select on public.presentations for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists games_owner_select on public.games;
create policy games_owner_select on public.games for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists marketplace_purchases_select on public.marketplace_purchases;
create policy marketplace_purchases_select on public.marketplace_purchases for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- Named `wallets_select`, not `credit_wallets_select`: the original is in
-- `202608070001` and dropping the wrong name would leave the old one in place
-- and add a second, wider policy beside it — policies are OR'd, so that would
-- have looked like a fix and changed nothing.
drop policy if exists wallets_select on public.credit_wallets;
create policy wallets_select on public.credit_wallets for select to authenticated
  using (user_id = (select auth.uid()));
