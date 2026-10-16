-- The support desk's two roles and its notification, added on their own: a
-- value added to an enum cannot be used in the transaction that adds it.
--
--   support_manager  sees every ticket, assigns them, manages nothing else
--   support_agent    answers tickets; assigns only to themselves
--
-- Neither is an administrator: `is_admin()` stays admin and super_admin only,
-- so a support role opens the Support page of the console and nothing more.

alter type public.app_role add value if not exists 'support_manager';
alter type public.app_role add value if not exists 'support_agent';
alter type public.notification_kind add value if not exists 'support_reply';
