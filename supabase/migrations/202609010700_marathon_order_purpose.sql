-- The order engine learns what a vote purchase is.
--
-- Alone in its own file because Postgres refuses to *use* an enum value in the
-- transaction that added it, and the migration that follows puts it to work.

alter type public.order_purpose add value if not exists 'marathon_votes';
