-- The ledger's two new kinds of row, added on their own: a value added to an
-- enum cannot be used in the transaction that adds it, and the economy
-- migration after this one writes functions that insert both.
--
--   plan_grant   — a tariff's monthly J Tanga, written when the order is paid
--   plan_expiry  — what was left of them when the month ran out unrenewed

alter type public.credit_transaction_type add value if not exists 'plan_grant';
alter type public.credit_transaction_type add value if not exists 'plan_expiry';
