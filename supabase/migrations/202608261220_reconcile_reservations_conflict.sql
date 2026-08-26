/**
 * The reconciliation, against the constraint the ledger actually has.
 *
 * `credit_transactions` is unique on `(user_id, idempotency_key)` rather than
 * on the key alone, so the previous `on conflict (idempotency_key)` matched no
 * constraint and the whole function raised. Same key, right target: releasing
 * the same stranded amount for the same wallet twice writes one entry.
 */
create or replace function public.reconcile_credit_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet record;
  v_owed integer;
  v_stranded integer;
  v_count integer := 0;
begin
  for v_wallet in
    select user_id, balance, reserved
    from public.credit_wallets
    where reserved > 0
    for update
  loop
    select coalesce(sum(reserved_credits), 0) into v_owed
    from public.generation_jobs
    where owner_id = v_wallet.user_id and status in ('running', 'queued');

    v_stranded := v_wallet.reserved - v_owed;
    if v_stranded <= 0 then continue; end if;

    update public.credit_wallets
      set balance = balance + v_stranded,
          reserved = reserved - v_stranded,
          updated_at = now()
      where user_id = v_wallet.user_id;

    insert into public.credit_transactions (
      user_id, type, amount, reservation_delta, balance_after, reserved_after, description,
      -- Every ledger entry needs one, and this is the only key that makes the
      -- release idempotent per wallet per amount: running the reconciliation
      -- twice must not write the same entry twice.
      idempotency_key
    ) values (
      v_wallet.user_id, 'release', v_stranded, -v_stranded,
      v_wallet.balance + v_stranded, v_wallet.reserved - v_stranded,
      'Tugamagan generatsiyadan qolgan band kredit qaytarildi',
      format('reconcile:%s:%s', v_wallet.user_id, v_stranded)
    )
    -- The ledger's key is unique per (user, key), not per key alone.
    on conflict (user_id, idempotency_key) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.reconcile_credit_reservations() is
  'Releases credit reservations no live generation job accounts for. Only ever increases a balance. Idempotent.';

revoke all on function public.reconcile_credit_reservations() from public, anon, authenticated;
grant execute on function public.reconcile_credit_reservations() to service_role;
