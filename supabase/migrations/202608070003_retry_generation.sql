create or replace function public.retry_generation(
  p_presentation_id uuid,
  p_idempotency_key text
)
returns table (presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_presentation public.presentations%rowtype;
  v_existing public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_job_id uuid;
  v_estimate integer;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if v_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;

  select * into v_existing from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_key;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  select * into v_presentation from public.presentations
  where id = p_presentation_id and owner_id = v_user_id for update;
  if not found then raise exception 'presentation not found' using errcode = 'P0002'; end if;
  if v_presentation.status <> 'failed' then raise exception 'only failed presentations can be retried' using errcode = '55000'; end if;
  if exists (select 1 from public.profiles where id = v_user_id and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  v_estimate := public.estimate_presentation_credits(v_presentation.style, v_presentation.requested_slide_count);
  select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
  if v_wallet.balance < v_estimate then raise exception 'insufficient credits' using errcode = 'P0001'; end if;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress,
    reserved_credits, attempt_count, context
  ) values (
    p_presentation_id, v_user_id, v_key, 'queued', 'preparing', 0,
    v_estimate,
    (select count(*)::integer from public.generation_jobs as previous_job where previous_job.presentation_id = p_presentation_id),
    jsonb_build_object('retry', true)
  ) returning id into v_job_id;

  insert into public.generation_steps (job_id, presentation_id, owner_id, sequence, key, label)
  values (v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda');

  update public.credit_wallets set
    balance = balance - v_estimate,
    reserved = reserved + v_estimate,
    version = version + 1
  where user_id = v_user_id;

  insert into public.credit_transactions (
    user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    v_user_id, v_job_id, 'reservation', -v_estimate, v_estimate,
    v_wallet.balance - v_estimate, v_wallet.reserved + v_estimate,
    'reserve:' || v_key, 'Presentation retry reservation',
    jsonb_build_object('presentation_id', p_presentation_id, 'retry', true)
  );

  update public.presentations set
    status = 'queued', estimated_credits = v_estimate, reserved_credits = v_estimate,
    actual_credits = 0, error_message = null
  where id = p_presentation_id;

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;

grant execute on function public.retry_generation(uuid, text) to authenticated;
