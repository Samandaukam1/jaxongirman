-- A payment you cannot finish is worse than one that failed.
--
-- The card is handed to Payme, the code is texted to the buyer, the order moves
-- to `awaiting_verification`, and the attempt id comes back so the next call can
-- name the attempt it is verifying. If that reply is lost — a dropped
-- connection, a backgrounded app, a response the client failed to read — the
-- buyer is holding an SMS for an attempt they can no longer name. Pressing pay
-- again asked Payme for a second card and a second code, so the first was
-- wasted; and the order sat in `awaiting_verification` looking healthy, which
-- it was.
--
-- That happened: JAX-2026-000008 reached `awaiting_verification` with no failure
-- recorded, while the buyer was told the attempt had not opened.
--
-- So the attempt can be asked for again. This returns what a client needs to
-- resume — never the provider token, which is the one thing that must not leave
-- the server, and which `payment_card_attempt_take` alone is allowed to consume.

create or replace function public.payment_card_attempt_active(
  p_subject_kind text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(coalesce(p_subject_kind, ''));
  v_user_id uuid;
  v_attempt public.payment_card_attempts%rowtype;
begin
  if v_kind = 'order' then
    select o.user_id into v_user_id from public.orders o where o.id = p_subject_id;
  elsif v_kind = 'marketplace' then
    select t.buyer_id into v_user_id from public.payment_transactions t where t.id = p_subject_id;
  else
    raise exception 'unknown payment subject kind' using errcode = '22023';
  end if;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'subject_not_found');
  end if;

  select * into v_attempt
    from public.payment_card_attempts
   where subject_kind = v_kind and subject_id = p_subject_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  end if;
  if v_attempt.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'attempt_expired');
  end if;
  -- A consumed token means a verify or a charge is already under way. Handing
  -- the id back would invite a second verify against a token that is gone.
  if v_attempt.provider_token is null then
    return jsonb_build_object('ok', false, 'code', 'attempt_in_progress');
  end if;

  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.id,
    'displayPan', v_attempt.display_pan,
    'expiryHint', lpad(v_attempt.expiry_month::text, 2, '0') || '/' || lpad(v_attempt.expiry_year::text, 2, '0')
  );
end;
$$;

revoke all on function public.payment_card_attempt_active(text, uuid) from public, anon, authenticated;
grant execute on function public.payment_card_attempt_active(text, uuid) to service_role;

comment on function public.payment_card_attempt_active(text, uuid) is
  'The live card attempt for a subject, without its provider token — so a client that lost the reply can resume the code it was already sent instead of asking for another.';
