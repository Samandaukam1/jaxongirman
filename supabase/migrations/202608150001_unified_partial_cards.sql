-- One trusted, provider-backed source of truth for "chala kartalar".
--
-- A payment spans two HTTP requests. The first request has the PAN in memory
-- long enough to give it to Payme; the second has the SMS code in memory long
-- enough to verify it. Neither value belongs in Postgres. What does have to
-- survive between those requests is:
--
--   * Payme's short-lived, single-use token; and
--   * the already-masked display hint plus MM/YY that the first request derived
--     in memory before the PAN disappeared.
--
-- This table is deliberately private. RLS is enabled with no policies and no
-- role has direct table privileges. The Edge functions can only use the narrow
-- SECURITY DEFINER RPCs below. There is no column for PAN, the four missing
-- digits, CVV or SMS code.

create table public.payment_card_attempts (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null,
  subject_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_token text,
  display_pan text not null,
  expiry_month smallint not null,
  expiry_year smallint not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id),
  constraint payment_card_attempts_subject_kind check (subject_kind in ('order', 'marketplace')),
  constraint payment_card_attempts_display_shape check (display_pan ~ '^[0-9]{8}XXXX[0-9]{4}$'),
  constraint payment_card_attempts_month check (expiry_month between 1 and 12),
  constraint payment_card_attempts_year check (expiry_year between 0 and 99),
  constraint payment_card_attempts_token_length check (
    provider_token is null or char_length(provider_token) between 1 and 4096
  ),
  constraint payment_card_attempts_consumption check (
    (provider_token is not null and consumed_at is null)
    or (provider_token is null and consumed_at is not null)
  )
);

create index payment_card_attempts_user_idx
  on public.payment_card_attempts (user_id, updated_at desc);
create index payment_card_attempts_expiry_idx
  on public.payment_card_attempts (expires_at);

comment on table public.payment_card_attempts is
  'Private bridge between card start and OTP verify. Contains one-time provider token and already-masked hint only; never PAN, missing digits, CVV or SMS code.';
comment on column public.payment_card_attempts.display_pan is
  'Display-only ########XXXX#### value produced in Edge memory before the full PAN is discarded.';
comment on column public.payment_card_attempts.provider_token is
  'Short-lived provider attempt token. Atomically nulled before verification and never exposed to a client role.';

alter table public.payment_card_attempts enable row level security;
revoke all on public.payment_card_attempts from public, anon, authenticated, service_role;

-- Two-digit years are representation, not policy. Whether a card is expired is
-- checked at the moment an attempt is opened and again before it is remembered.
alter table public.partial_cards drop constraint partial_cards_year;
alter table public.partial_cards
  add constraint partial_cards_year check (expiry_year between 0 and 99);

/**
 * Opens or replaces the private card half of a payment attempt.
 *
 * Ownership is derived from the payment row, never accepted from the caller.
 * The display constraint means this function has no argument capable of
 * carrying a full PAN into storage.
 */
create or replace function public.payment_card_attempt_set(
  p_subject_kind text,
  p_subject_id uuid,
  p_token text,
  p_display_pan text,
  p_expiry_month integer,
  p_expiry_year integer,
  p_minutes integer default 15
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  v_user_id uuid;
  v_expiry_start date;
  v_attempt_id uuid;
  v_existing public.payment_card_attempts%rowtype;
begin
  if p_subject_id is null then
    raise exception 'payment subject is required' using errcode = '22023';
  end if;
  if nullif(p_token, '') is null or char_length(p_token) > 4096 then
    raise exception 'provider token is malformed' using errcode = '22023';
  end if;
  if p_display_pan !~ '^[0-9]{8}XXXX[0-9]{4}$' then
    raise exception 'masked card hint is malformed' using errcode = '22023';
  end if;
  if p_expiry_month not between 1 and 12 or p_expiry_year not between 0 and 99 then
    raise exception 'card expiry is malformed' using errcode = '22023';
  end if;

  v_expiry_start := make_date(2000 + p_expiry_year::integer, p_expiry_month::integer, 1);
  if (v_expiry_start + interval '1 month')::date <= current_date then
    raise exception 'card is expired' using errcode = '22023';
  end if;

  if v_kind = 'order' then
    select o.user_id into v_user_id
      from public.orders o
      where o.id = p_subject_id
        and o.status in ('pending'::public.order_status, 'awaiting_verification'::public.order_status)
      for update;
  elsif v_kind = 'marketplace' then
    select t.buyer_id into v_user_id
      from public.payment_transactions t
      where t.id = p_subject_id
        and t.state in ('created'::public.payment_state, 'card_created'::public.payment_state,
                        'otp_requested'::public.payment_state, 'failed'::public.payment_state)
      for update;
  else
    raise exception 'unknown payment subject kind' using errcode = '22023';
  end if;

  if v_user_id is null then
    raise exception 'open payment subject not found' using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.payment_card_attempts
    where subject_kind = v_kind and subject_id = p_subject_id
    for update;
  if found and v_existing.expires_at > now() and v_existing.provider_token is null then
    -- Never replace a consumed token that another request is verifying or
    -- charging. An unconsumed attempt is safe to replace because its immutable
    -- ID makes the old verify return not_found instead of taking the new token.
    raise exception 'payment card attempt already active' using errcode = '55000';
  end if;
  if found then
    delete from public.payment_card_attempts where id = v_existing.id;
  end if;

  insert into public.payment_card_attempts (
    id, subject_kind, subject_id, user_id, provider_token, display_pan,
    expiry_month, expiry_year, expires_at, consumed_at, updated_at
  ) values (
    gen_random_uuid(), v_kind, p_subject_id, v_user_id, p_token, p_display_pan,
    p_expiry_month, p_expiry_year,
    now() + make_interval(mins => greatest(least(coalesce(p_minutes, 15), 30), 1)),
    null, now()
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

/**
 * Atomically spends an attempt token.
 *
 * The masked hint remains private in this row until the paid wrapper promotes
 * it to partial_cards. A second verify receives `attempt_consumed`, so two
 * concurrent requests can never charge with the same token.
 */
create or replace function public.payment_card_attempt_take(
  p_subject_kind text,
  p_subject_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  v_attempt public.payment_card_attempts%rowtype;
  v_token text;
begin
  select * into v_attempt
    from public.payment_card_attempts
    where id = p_attempt_id
      and subject_kind = v_kind
      and subject_id = p_subject_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  end if;
  if v_attempt.expires_at <= now() then
    delete from public.payment_card_attempts
      where id = p_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'attempt_expired');
  end if;
  if v_attempt.provider_token is null then
    return jsonb_build_object('ok', false, 'code', 'attempt_consumed');
  end if;

  v_token := v_attempt.provider_token;
  update public.payment_card_attempts set
    provider_token = null,
    consumed_at = now(),
    updated_at = now()
    where id = p_attempt_id;

  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.id,
    'token', v_token,
    'displayPan', v_attempt.display_pan,
    'expiryMonth', v_attempt.expiry_month,
    'expiryYear', v_attempt.expiry_year
  );
end;
$$;

create or replace function public.payment_card_attempt_clear(
  p_subject_kind text,
  p_subject_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.payment_card_attempts
    where subject_kind = lower(btrim(coalesce(p_subject_kind, '')))
      and subject_id = p_subject_id
      and id = p_attempt_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

/**
 * The only writer of saved card hints.
 *
 * A duplicate refreshes last_used_at and expiry instead of creating another
 * row. This RPC is service-only; clients have their existing own-row SELECT and
 * DELETE policies and no INSERT/UPDATE capability.
 */
create or replace function public.remember_partial_card(
  p_user_id uuid,
  p_display_pan text,
  p_expiry_month integer,
  p_expiry_year integer
)
returns public.partial_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.partial_cards%rowtype;
  v_expiry_start date;
begin
  if p_user_id is null then
    raise exception 'card owner is required' using errcode = '22023';
  end if;
  if p_display_pan !~ '^[0-9]{8}XXXX[0-9]{4}$' then
    raise exception 'masked card hint is malformed' using errcode = '22023';
  end if;
  if p_expiry_month not between 1 and 12 or p_expiry_year not between 0 and 99 then
    raise exception 'card expiry is malformed' using errcode = '22023';
  end if;

  v_expiry_start := make_date(2000 + p_expiry_year::integer, p_expiry_month::integer, 1);
  if (v_expiry_start + interval '1 month')::date <= current_date then
    raise exception 'card is expired' using errcode = '22023';
  end if;

  insert into public.partial_cards (
    user_id, display_pan, last4, expiry_month, expiry_year, is_active, last_used_at
  ) values (
    p_user_id, p_display_pan, right(p_display_pan, 4),
    p_expiry_month, p_expiry_year, true, now()
  )
  on conflict (user_id, display_pan) do update set
    expiry_month = excluded.expiry_month,
    expiry_year = excluded.expiry_year,
    is_active = true,
    last_used_at = now()
  returning * into v_card;

  return v_card;
end;
$$;

/**
 * Persists the provider receipt before the charge is attempted, then marks the
 * order processing in the same commit. If the Edge process dies after Payme
 * takes money, reconciliation still has the exact receipt to ask about.
 */
create or replace function public.order_mark_processing(
  p_order_id uuid,
  p_payme_receipt_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if nullif(btrim(coalesce(p_payme_receipt_id, '')), '') is null then
    raise exception 'provider receipt id is required' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'paid'::public.order_status then
    return false;
  end if;
  if v_order.status not in ('pending'::public.order_status, 'awaiting_verification'::public.order_status) then
    raise exception 'order cannot begin provider processing from %', v_order.status using errcode = '22023';
  end if;

  update public.orders
    set payme_receipt_id = p_payme_receipt_id
    where id = p_order_id;
  perform public.order_advance(p_order_id, 'processing'::public.order_status);
  return true;
end;
$$;

/**
 * Provider-paid order completion and card promotion in one database commit.
 */
create or replace function public.order_fulfil_and_remember_card(
  p_order_id uuid,
  p_attempt_id uuid,
  p_payme_receipt_id text default null,
  p_payme_transaction_id text default null,
  p_provider_cost integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_attempt public.payment_card_attempts%rowtype;
  v_card public.partial_cards%rowtype;
begin
  v_result := public.order_fulfil(
    p_order_id, p_payme_receipt_id, p_payme_transaction_id, p_provider_cost
  );

  select * into v_attempt
    from public.payment_card_attempts
    where id = p_attempt_id
      and subject_kind = 'order'
      and subject_id = p_order_id
      and provider_token is null
      and consumed_at is not null
    for update;

  if not found then
    raise exception 'payment card attempt changed before fulfilment' using errcode = '40001';
  end if;

  v_card := public.remember_partial_card(
    v_attempt.user_id, v_attempt.display_pan,
    v_attempt.expiry_month, v_attempt.expiry_year
  );
  update public.payment_transactions
    set partial_card_id = v_card.id
    where order_id = p_order_id;
  delete from public.payment_card_attempts where id = p_attempt_id;
  v_result := v_result || jsonb_build_object(
    'partial_card_id', v_card.id,
    'masked_card', v_card.display_pan
  );

  return v_result;
end;
$$;

/**
 * Provider-paid legacy marketplace settlement and the same card promotion in
 * one database commit. This keeps the still-reachable legacy checkout on the
 * same partial_cards source of truth as every order checkout.
 */
create or replace function public.marketplace_settle_and_remember_card(
  p_transaction_id uuid,
  p_attempt_id uuid,
  p_provider_cost integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_attempt public.payment_card_attempts%rowtype;
  v_card public.partial_cards%rowtype;
begin
  v_result := public.marketplace_settle_payment(p_transaction_id, p_provider_cost);

  select * into v_attempt
    from public.payment_card_attempts
    where id = p_attempt_id
      and subject_kind = 'marketplace'
      and subject_id = p_transaction_id
      and provider_token is null
      and consumed_at is not null
    for update;

  if not found then
    raise exception 'payment card attempt changed before settlement' using errcode = '40001';
  end if;

  v_card := public.remember_partial_card(
    v_attempt.user_id, v_attempt.display_pan,
    v_attempt.expiry_month, v_attempt.expiry_year
  );
  update public.payment_transactions
    set partial_card_id = v_card.id
    where id = p_transaction_id;
  delete from public.payment_card_attempts where id = p_attempt_id;
  v_result := v_result || jsonb_build_object(
    'partial_card_id', v_card.id,
    'masked_card', v_card.display_pan
  );

  return v_result;
end;
$$;

-- The old helper trusted fragments echoed by the client. Remove the capability
-- after both Edge functions have moved to the private attempt row.
drop function if exists public.marketplace_remember_partial_card(
  uuid, text, text, smallint, smallint
);

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.payment_card_attempt_set(text, uuid, text, text, integer, integer, integer)',
    'public.payment_card_attempt_take(text, uuid, uuid)',
    'public.payment_card_attempt_clear(text, uuid, uuid)',
    'public.remember_partial_card(uuid, text, integer, integer)',
    'public.order_mark_processing(uuid, text)',
    'public.order_fulfil_and_remember_card(uuid, uuid, text, text, integer)',
    'public.marketplace_settle_and_remember_card(uuid, uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
