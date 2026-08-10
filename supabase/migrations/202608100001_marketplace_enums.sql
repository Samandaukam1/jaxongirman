-- Enum labels the marketplace needs, alone in this file because Postgres refuses
-- to *use* an enum value in the same transaction that adds it. The migrations
-- that follow are what put them to work. Same shape as 202608090001.

-- The inbox learns what a marketplace can announce. `marketplace_sale` and
-- `marketplace_purchase` already exist and are reused for the two sides of a
-- sale; these are the states around them.
alter type public.notification_kind add value if not exists 'product_approved';
alter type public.notification_kind add value if not exists 'product_rejected';
alter type public.notification_kind add value if not exists 'settlement_upcoming';
alter type public.notification_kind add value if not exists 'settlement_paid';
alter type public.notification_kind add value if not exists 'refund';

-- A marketplace purchase moves som, not coins, so it never touches
-- credit_transactions. These two exist for the day a product is priced in
-- J Coin instead — the ledger has to be able to name the movement before any
-- code can make it.
alter type public.credit_transaction_type add value if not exists 'marketplace_spend';
alter type public.credit_transaction_type add value if not exists 'marketplace_earn';
