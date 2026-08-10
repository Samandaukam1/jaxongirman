-- Lets a buyer start over from anywhere the money is not yet in flight.
--
-- The retry edge added in 202608100007 only left `failed`, which missed the
-- common case: a recoverable error — a mistyped code, a card the provider would
-- not accept — leaves the attempt sitting at `otp_requested`, and pressing "pay"
-- again has to be able to begin a fresh card there too.
--
-- Restart is allowed from every state before the charge is submitted. It is
-- deliberately NOT allowed from `processing` (the provider may be moving money)
-- or from `paid`, so no sequence of restarts can reach a second charge or undo
-- a completed one.

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
    -- Restart, from anything that has not yet been submitted for payment.
    ('failed', 'created'),
    ('card_created', 'created'),
    ('otp_requested', 'created'),
    ('card_verified', 'created'),
    ('receipt_created', 'created')
  );
$$;

/** Advances a payment. A restart wipes whatever the last attempt left behind. */
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

  v_restart := p_to = 'created'::public.payment_state;
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
    -- A restart also drops the previous attempt's token: the next card gets a
    -- new one, and nothing from the abandoned try can be replayed.
    provider_card_token = case when v_restart then null else provider_card_token end,
    attempt_expires_at = case when v_restart then null else attempt_expires_at end,
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
