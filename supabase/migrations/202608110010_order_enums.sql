-- Enum labels the unified order engine needs. They live alone in this file
-- because Postgres refuses to *use* an enum value in the same transaction that
-- adds it — the migration that follows is what puts them to work.

/**
 * What an order is for.
 *
 * One list rather than a boolean per product line, so a new thing to sell is a
 * new label plus a pricing branch, not a second payment path. The marketplace
 * values mirror `marketplace_material_types.code` so an order can be traced back
 * to the kind of thing it bought without joining.
 */
create type public.order_purpose as enum (
  'subscription',
  'jcoin',
  'data_collection',
  'marketplace_presentation',
  'marketplace_reference',
  'marketplace_independent_work',
  'marketplace_game',
  'other_marketplace_product'
);

/**
 * Where an order is in its life.
 *
 * Distinct from `payment_state`, which describes one attempt at a provider:
 * a card can fail three times while the order stays `pending`. Only the order
 * decides whether anything is owed or owned.
 *
 * `awaiting_verification` is the SMS step; `processing` is the window where the
 * provider has been asked to charge and has not yet answered — the state a
 * recovery sweep looks for.
 */
create type public.order_status as enum (
  'pending',
  'awaiting_verification',
  'processing',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'expired'
);

-- The ledger learns to name a coin purchase that came from real money, as
-- distinct from an admin grant or a person-to-person transfer.
alter type public.credit_transaction_type add value if not exists 'coin_purchase';

-- The inbox learns what an order can announce.
alter type public.notification_kind add value if not exists 'order_paid';
alter type public.notification_kind add value if not exists 'order_failed';
