-- Enum labels the home screen, the coin transfer and the data-collection module
-- need. They live alone in this file because Postgres refuses to *use* an enum
-- value in the same transaction that adds it — the migrations that follow are
-- what put them to work. Same shape as 202608081600_super_admin_role.sql.

-- The inbox learns the kinds of thing the platform can now announce. The older
-- labels ('credit_gift', 'system', 'presentation') stay: rows already carry them.
alter type public.notification_kind add value if not exists 'survey_invite';
alter type public.notification_kind add value if not exists 'survey_deadline';
alter type public.notification_kind add value if not exists 'survey_completed';
alter type public.notification_kind add value if not exists 'project_ready';
alter type public.notification_kind add value if not exists 'marketplace_sale';
alter type public.notification_kind add value if not exists 'marketplace_purchase';
alter type public.notification_kind add value if not exists 'credit_received';
alter type public.notification_kind add value if not exists 'credit_sent';
alter type public.notification_kind add value if not exists 'subscription_expiry';

-- A person-to-person transfer is neither a grant nor a charge: it moves coins
-- sideways, and both halves must be nameable in the one immutable ledger.
alter type public.credit_transaction_type add value if not exists 'transfer_in';
alter type public.credit_transaction_type add value if not exists 'transfer_out';
