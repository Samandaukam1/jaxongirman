-- Makes a payment survivable.
--
-- The first version treated every error as terminal, so a mistyped verification
-- code moved the transaction to `failed` and there was no way back: the buyer
-- lost the checkout over a typo. That is wrong twice over — a rejected code is
-- not a failed payment, and even a genuine decline should let someone try
-- another card against the same agreed price.
--
-- Two changes:
--   * `failed -> created` is now a legal move, so one checkout can be retried
--     without opening a second one and re-quoting the buyer.
--   * a restart clears the previous attempt's error, so the row describes the
--     attempt in progress rather than the last one that went wrong.

create or replace function public.payment_transition_allowed(
  p_from public.payment_state,
  p_to public.payment_state
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('created', 'card_created'), ('created', 'failed'), ('created', 'cancelled'),
    ('card_created', 'otp_requested'), ('card_created', 'failed'), ('card_created', 'cancelled'),
    ('otp_requested', 'card_verified'), ('otp_requested', 'otp_requested'),
    ('otp_requested', 'failed'), ('otp_requested', 'cancelled'),
    ('card_verified', 'receipt_created'), ('card_verified', 'failed'), ('card_verified', 'cancelled'),
    ('receipt_created', 'processing'), ('receipt_created', 'failed'), ('receipt_created', 'cancelled'),
    ('processing', 'paid'), ('processing', 'failed'),
    ('paid', 'refunded'),
    -- Retry. Deliberately the only edge out of `failed`: a failed payment can be
    -- attempted again, but it can never jump straight to paid.
    ('failed', 'created')
  );
$$;

/**
 * Advances a payment. Server-side only.
 *
 * Restarting a failed attempt wipes the previous error and the stale receipt,
 * so nothing from the last try is mistaken for the state of this one.
 */
create or replace function public.payment_advance(
  p_transaction_id uuid,
  p_to public.payment_state,
  p_event text default '',
  p_provider_receipt_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null
)
returns public.payment_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.payment_transactions%rowtype;
  v_from public.payment_state;
  v_message text;
  v_restart boolean;
begin
  select * into v_transaction from public.payment_transactions where id = p_transaction_id for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;

  v_from := v_transaction.state;
  if not public.payment_transition_allowed(v_from, p_to) then
    raise exception 'payment cannot move from % to %', v_from, p_to using errcode = '22023';
  end if;

  v_restart := v_from = 'failed'::public.payment_state and p_to = 'created'::public.payment_state;

  -- Redacted before storage, not after. A provider message that quotes a card
  -- number must not become the reason this row violates its own constraint.
  v_message := regexp_replace(coalesce(p_provider_error_message, ''), '[0-9]{12,}', '[redacted]', 'g');

  update public.payment_transactions set
    state = p_to,
    provider_receipt_id = case when v_restart then null else coalesce(p_provider_receipt_id, provider_receipt_id) end,
    provider_error_code = case
      when v_restart then null
      when p_to = 'failed'::public.payment_state then p_provider_error_code
      else provider_error_code end,
    provider_error_message = case
      when v_restart then null
      when p_to = 'failed'::public.payment_state then nullif(v_message, '')
      else provider_error_message end,
    failed_at = case when v_restart then null when p_to = 'failed'::public.payment_state then now() else failed_at end,
    paid_at = case when p_to = 'paid'::public.payment_state then now() else paid_at end
    where id = p_transaction_id
    returning * into v_transaction;

  insert into public.payment_audit_events (transaction_id, event, state_from, state_to, provider_code, message)
  values (
    p_transaction_id, left(coalesce(nullif(btrim(p_event), ''), 'state.change'), 100),
    v_from, p_to, p_provider_error_code, left(v_message, 1000)
  );

  return v_transaction;
end;
$$;
