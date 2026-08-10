-- A place for the provider's one-time card token to live between the two HTTP
-- requests that make up a payment.
--
-- This is NOT a saved card. The distinction matters and the schema enforces it:
--
--   * the token belongs to one payment attempt and is written by the server only;
--   * `payment_clear_attempt_token()` wipes it the moment the attempt reaches a
--     terminal state, so it cannot be reused for a second purchase;
--   * no client role can read the column — `authenticated` keeps SELECT on the
--     table, so the grant is narrowed to the columns a buyer legitimately sees.
--
-- Without it the alternative is handing the token back to the client between
-- steps, which would put a live payment credential in the app's memory and in
-- its network log.

alter table public.payment_transactions
  add column if not exists provider_card_token text,
  add column if not exists attempt_expires_at timestamptz;

comment on column public.payment_transactions.provider_card_token is
  'One-time provider token for the current attempt. Cleared on settle, failure or expiry. Never a saved card.';

-- Re-grant SELECT column by column: the token and nothing else is withheld.
revoke select on public.payment_transactions from authenticated;
grant select (
  id, buyer_id, product_id, seller_id, state, provider, provider_receipt_id,
  provider_error_code, provider_error_message, base_price, currency,
  buyer_fee_rate, buyer_fee_amount, buyer_total, seller_fee_rate, seller_fee_amount,
  seller_net, platform_gross, provider_cost, partial_card_id, idempotency_key,
  paid_at, failed_at, created_at, updated_at, is_sandbox, attempt_expires_at
) on public.payment_transactions to authenticated;

/** Drops the attempt's token. Called at every terminal state. */
create or replace function public.payment_clear_attempt_token(p_transaction_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_transactions
    set provider_card_token = null, attempt_expires_at = null
    where id = p_transaction_id;
$$;

/** Stores the token for this attempt, with a short window it stays usable in. */
create or replace function public.payment_set_attempt_token(
  p_transaction_id uuid,
  p_token text,
  p_minutes integer default 15
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_transactions
    set provider_card_token = p_token,
        attempt_expires_at = now() + make_interval(mins => greatest(coalesce(p_minutes, 15), 1))
    where id = p_transaction_id;
$$;

/** Reads the token back, refusing one whose window has closed. */
create or replace function public.payment_take_attempt_token(p_transaction_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payment_transactions%rowtype;
begin
  select * into v_row from public.payment_transactions where id = p_transaction_id;
  if not found or v_row.provider_card_token is null then
    raise exception 'To‘lov urinishi topilmadi. Qaytadan boshlang.' using errcode = '22023';
  end if;
  if v_row.attempt_expires_at is not null and v_row.attempt_expires_at <= now() then
    perform public.payment_clear_attempt_token(p_transaction_id);
    raise exception 'To‘lov urinishi muddati tugadi. Qaytadan boshlang.' using errcode = '22023';
  end if;
  return v_row.provider_card_token;
end;
$$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.payment_clear_attempt_token(uuid)',
    'public.payment_set_attempt_token(uuid, text, integer)',
    'public.payment_take_attempt_token(uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('revoke all on function %s from authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
