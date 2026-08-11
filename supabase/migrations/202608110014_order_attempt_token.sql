-- The provider's one-time card token, for an order.
--
-- Same shape as `payment_transactions.provider_card_token` and for the same
-- reason: the token lives between the two halves of one attempt — the call that
-- asks for a verification code, and the call that spends it — and it must not be
-- readable by any client role in between.
--
-- The mechanism is a column grant, not a policy. RLS filters rows; it has
-- nothing to say about which columns a caller may ask for, so the table-wide
-- SELECT is withdrawn and re-granted column by column with the token left out.
-- A client that asks for it gets a privilege error rather than a null.
--
-- What is deliberately not here: the card number, the four digits a buyer
-- re-typed, and the verification code. None of the three is ever written.

alter table public.orders
  add column provider_card_token text,
  add column attempt_expires_at timestamptz,
  -- A token that outlives its attempt is a token somebody could replay. Fifteen
  -- minutes is longer than any SMS lasts and shorter than a session.
  add constraint orders_attempt_window check (
    attempt_expires_at is null or provider_card_token is not null
  );

-- Withdraw the table-wide grant the orders migration handed out, then restore
-- exactly the columns a person legitimately sees about their own purchase.
revoke select on public.orders from authenticated;
grant select (
  id, order_number, user_id, purpose, status,
  product_id, coin_package_id, reference_code, seller_id,
  currency, subtotal, buyer_fee, total_amount,
  seller_fee, seller_net, platform_revenue,
  buyer_fee_rate, seller_fee_rate,
  payme_receipt_id, payme_transaction_id,
  is_test, failure_code, failure_message, metadata,
  created_at, updated_at, paid_at, cancelled_at, expires_at
) on public.orders to authenticated;

/** Wipes the token. Called the moment an attempt reaches a terminal state. */
create or replace function public.order_clear_attempt_token(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders
    set provider_card_token = null, attempt_expires_at = null
    where id = p_order_id;
$$;

create or replace function public.order_set_attempt_token(
  p_order_id uuid,
  p_token text,
  p_minutes integer default 15
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders
    set provider_card_token = p_token,
        attempt_expires_at = now() + make_interval(mins => greatest(coalesce(p_minutes, 15), 1))
    where id = p_order_id;
$$;

/**
 * Spends the token: returns it and wipes it in the same call.
 *
 * Single-use by construction. A second verify for the same attempt finds
 * nothing, which is what stops a replayed request from charging a card twice.
 */
create or replace function public.order_take_attempt_token(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_expires timestamptz;
begin
  select provider_card_token, attempt_expires_at into v_token, v_expires
    from public.orders where id = p_order_id for update;

  if v_token is null then
    raise exception 'To‘lov urinishi topilmadi. Qaytadan boshlang.' using errcode = '22023';
  end if;
  if v_expires is not null and v_expires <= now() then
    perform public.order_clear_attempt_token(p_order_id);
    raise exception 'To‘lov urinishi muddati tugadi. Qaytadan boshlang.' using errcode = '22023';
  end if;

  perform public.order_clear_attempt_token(p_order_id);
  return v_token;
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.order_clear_attempt_token(uuid)',
    'public.order_set_attempt_token(uuid, text, integer)',
    'public.order_take_attempt_token(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
