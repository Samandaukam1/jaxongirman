-- Server-side credit grants addressed by email.
--
-- public.admin_adjust_credits already applies an atomic, ledgered and audited
-- adjustment, but it identifies the account by uuid and requires an admin
-- session. A grant run from the server has neither: it knows the person's email
-- and executes as the service role, where auth.uid() is null. This adds that
-- entry point without loosening anything the existing one enforces — same
-- wallet update, same ledger row, same audit trail, same admin gate for anyone
-- arriving over the API.

create or replace function public.admin_grant_credits_by_email(
  p_email text,
  p_amount integer,
  p_reason text,
  p_idempotency_key text,
  p_actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_actor uuid;
  v_user_id uuid;
  v_key text;
  v_transaction_id uuid;
  v_existing public.credit_transactions%rowtype;
  v_before public.credit_wallets%rowtype;
  v_after public.credit_wallets%rowtype;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'email is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be a non-zero integer' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'reason and idempotency key are required' using errcode = '22023';
  end if;

  -- Anyone arriving with a session must hold the admin role. The service role
  -- has no uid and never leaves the server, so it is trusted here; execute is
  -- revoked from PUBLIC below so anon can never reach this function at all.
  if v_caller is not null and not public.is_admin(v_caller) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no account is registered with email %', btrim(p_email) using errcode = 'P0002';
  end if;

  -- The audit table insists on a real admin, so the actor is the caller, or the
  -- admin named in p_actor_email, or the recipient when an admin is topping up
  -- their own account — which is exactly what a manual server grant is.
  v_actor := v_caller;
  if v_actor is null and nullif(btrim(coalesce(p_actor_email, '')), '') is not null then
    select id into v_actor from auth.users where lower(email) = lower(btrim(p_actor_email));
    if v_actor is null then
      raise exception 'no account is registered with actor email %', btrim(p_actor_email) using errcode = 'P0002';
    end if;
  end if;
  if v_actor is null and public.is_admin(v_user_id) then
    v_actor := v_user_id;
  end if;
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'an admin actor is required for the audit trail: pass p_actor_email of an account holding the admin role'
      using errcode = '42501';
  end if;

  -- Locking the wallet before the idempotency check is what makes a retry safe
  -- under concurrency: the second call waits here, then sees the ledger row.
  select * into v_before from public.credit_wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'credit wallet not found for %', btrim(p_email) using errcode = 'P0002';
  end if;

  v_key := 'admin:' || btrim(p_idempotency_key);
  select * into v_existing
    from public.credit_transactions
    where user_id = v_user_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'applied', false,
      'email', btrim(p_email),
      'user_id', v_user_id,
      'granted', 0,
      'balance', v_before.balance,
      'reserved', v_before.reserved,
      'transaction_id', v_existing.id,
      'message', 'this idempotency key was already applied; balance left unchanged'
    );
  end if;

  if v_before.balance + p_amount < 0 then
    raise exception 'adjustment would create a negative balance' using errcode = '22003';
  end if;

  update public.credit_wallets
    set balance = balance + p_amount,
        lifetime_granted = lifetime_granted + greatest(p_amount, 0),
        version = version + 1
    where user_id = v_user_id
    returning * into v_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key,
    description, created_by, metadata
  ) values (
    v_user_id, 'admin_adjustment', p_amount, v_after.balance, v_after.reserved, v_key,
    left(btrim(p_reason), 500), v_actor,
    jsonb_build_object(
      'previous_balance', v_before.balance,
      'email', btrim(p_email),
      'actor', case when v_caller is null then 'service_role' else 'admin_session' end
    )
  )
  returning id into v_transaction_id;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, before_data, after_data, reason, request_id
  ) values (
    v_actor, 'credits.grant_by_email', 'user', v_user_id::text,
    to_jsonb(v_before), to_jsonb(v_after), left(btrim(p_reason), 500),
    case when v_caller is null then 'service_role' else 'admin_session' end
  );

  return jsonb_build_object(
    'applied', true,
    'email', btrim(p_email),
    'user_id', v_user_id,
    'granted', p_amount,
    'previous_balance', v_before.balance,
    'balance', v_after.balance,
    'reserved', v_after.reserved,
    'transaction_id', v_transaction_id
  );
end;
$$;

-- Functions are executable by PUBLIC unless told otherwise, and anon inherits
-- that, so the default has to be taken away before anything is handed out.
revoke all on function public.admin_grant_credits_by_email(text, integer, text, text, text) from public;
grant execute on function public.admin_grant_credits_by_email(text, integer, text, text, text) to service_role;
grant execute on function public.admin_grant_credits_by_email(text, integer, text, text, text) to authenticated;

comment on function public.admin_grant_credits_by_email(text, integer, text, text, text) is
  'Adds credits to the wallet of the account with this email. Atomic, ledgered as admin_adjustment, audited, and idempotent per key. Service role or an admin session only.';
