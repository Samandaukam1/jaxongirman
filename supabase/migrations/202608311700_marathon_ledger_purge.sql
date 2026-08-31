-- Votes disappear with their campaign, and in no other way.
--
-- The ledger refused every delete, which is right for a single row and wrong
-- for a whole campaign: an administrator removing a draft they never ran, or a
-- deletion request that has to be honoured, both left rows nothing could
-- remove — and the campaign could not be deleted either, because its votes
-- would not go.
--
-- A cascade is distinguishable from a direct delete without any flag: during a
-- cascade the parent row is already gone. So a vote may be removed exactly when
-- the campaign it belongs to no longer exists, which is the rule we wanted
-- stated all along.

create or replace function public.marathon_ledger_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.marathon_campaigns c where c.id = old.campaign_id) then
      return old;
    end if;
    raise exception 'a vote can only be removed with its campaign' using errcode = '42501';
  end if;
  raise exception 'marathon vote ledger is append-only' using errcode = '42501';
end;
$$;
