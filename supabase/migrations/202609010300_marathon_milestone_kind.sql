-- A milestone decision has to be tellable.
--
-- `notification_kind` is an enum, so the notification written inside
-- `marathon_decide_milestone` failed on its own type — and it is written in the
-- same transaction as the decision, which meant a candidate could not claim or
-- forfeit a reward at all. Added the way `marathon_vote` was.
--
-- In its own migration on purpose: a value added to an enum cannot be used in
-- the transaction that added it, and every function that writes one runs later.

do $$ begin
  alter type public.notification_kind add value if not exists 'marathon_milestone';
exception when others then null; end $$;
