/**
 * Taking a gift back.
 *
 * Sending coins is one tap and the amount is typed by hand, so the mistake this
 * exists for is an ordinary one: a zero too many, or the same press twice on a
 * slow connection. Until now the only way back was an admin editing a wallet
 * directly, which leaves the ledger and the balance disagreeing.
 *
 * Three decisions worth stating, because they are the ones somebody will
 * question later.
 *
 * **It never takes more than is there.** `credit_wallets` refuses a negative
 * balance, so an amount larger than what the person still holds would fail the
 * whole call — exactly when it is most needed, on a gift that has been partly
 * spent. It takes what it can instead and reports the rest as a shortfall, so
 * the admin sees "asked 500, took 320" rather than an error that explains
 * nothing.
 *
 * **It only touches spendable balance.** Reserving moves coins out of `balance`
 * into `reserved`, so work already in flight is paid for and is not clawed back
 * underneath the person running it.
 *
 * **The person is told.** Money leaving an account without a word is worse than
 * the mistake that put it there, so this writes a notification carrying the
 * admin's own reason — which is why the reason is required rather than
 * optional. The kind is `system` and not `credit_gift`: the app throws a
 * celebration overlay for gift notifications, and this is not that.
 */

create or replace function public.admin_reclaim_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_key text;
  v_reason text;
  v_before public.credit_wallets%rowtype;
  v_after public.credit_wallets%rowtype;
  v_taken integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'reclaim amount must be greater than zero' using errcode = '22023';
  end if;

  -- Required, and required here rather than only in the form: this is the only
  -- record of why somebody's balance went down, and a blank one is useless to
  -- whoever reads the ledger next.
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'reclaim reason is required' using errcode = '22023';
  end if;

  v_key := 'reclaim:' || coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  select * into v_before from public.credit_wallets where user_id = p_user_id for update;
  if not found then
    raise exception 'credit wallet not found' using errcode = 'P0002';
  end if;

  -- Only the presence of the ledger row matters, never its contents: a repeated
  -- press must not take the coins twice.
  if exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and idempotency_key = v_key
  ) then
    return jsonb_build_object(
      'applied', false, 'requested', p_amount, 'taken', 0,
      'shortfall', 0, 'balance', v_before.balance, 'message', 'already reclaimed'
    );
  end if;

  v_taken := least(p_amount, v_before.balance);

  if v_taken <= 0 then
    return jsonb_build_object(
      'applied', false, 'requested', p_amount, 'taken', 0,
      'shortfall', p_amount, 'balance', v_before.balance,
      'message', 'balance is empty'
    );
  end if;

  update public.credit_wallets
    set balance = balance - v_taken,
        -- A gift that is taken back was not granted. Floored because a wallet
        -- topped up before this feature existed may have less recorded than it
        -- has been given.
        lifetime_granted = greatest(lifetime_granted - v_taken, 0),
        version = version + 1
    where user_id = p_user_id
    returning * into v_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    p_user_id, 'admin_adjustment', -v_taken, v_after.balance, v_after.reserved, v_key,
    left(v_reason, 500), v_admin,
    jsonb_build_object(
      'reclaim', true,
      'requested', p_amount,
      'previous_balance', v_before.balance
    )
  );

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    p_user_id, 'system',
    v_taken || ' tanga qaytarib olindi',
    left(v_reason, 500),
    jsonb_build_object('amount', -v_taken, 'balance', v_after.balance, 'reclaim', true)
  );

  return jsonb_build_object(
    'applied', true,
    'requested', p_amount,
    'taken', v_taken,
    'shortfall', greatest(p_amount - v_taken, 0),
    'balance', v_after.balance,
    'message', null
  );
end;
$$;

revoke all on function public.admin_reclaim_credits(uuid, integer, text, text) from public;
revoke all on function public.admin_reclaim_credits(uuid, integer, text, text) from anon;
grant execute on function public.admin_reclaim_credits(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_reclaim_credits(uuid, integer, text, text) to service_role;

comment on function public.admin_reclaim_credits(uuid, integer, text, text) is
  'Takes back gifted coins, never below zero and never out of reserved funds. Reason is required and is shown to the person.';
