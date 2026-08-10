-- Lets an account actually be deleted.
--
-- `credit_transactions_immutable` refuses every DELETE on the ledger, which is
-- right for a ledger — and wrong for the one delete that is not a mutation of
-- the ledger at all: erasing the person it belongs to. Because
-- credit_transactions.user_id cascades from auth.users, removing an account
-- reached this trigger and failed with "credit transactions are immutable", so
-- `auth.admin.deleteUser` has never worked on this project. (Found while the
-- data-collection smoke test tried to clean up after itself.)
--
-- The exemption is narrow and self-checking: a cascade deletes the parent
-- first, so by the time this trigger fires there is no auth.users row left. A
-- direct DELETE by anyone — which no client role has the privilege for in any
-- case — still finds the user present and is still refused.

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;
  raise exception 'credit transactions are immutable' using errcode = '42501';
end;
$$;

comment on function public.reject_ledger_mutation() is
  'Makes the credit ledger append-only. The single exception is the cascade from a deleted account, identified by the parent row already being gone.';
