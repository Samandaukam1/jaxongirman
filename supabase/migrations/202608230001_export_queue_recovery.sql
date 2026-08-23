/**
 * An export worker that dies must not lock a person out of their own files.
 *
 * `request_export` admits at most two live jobs per account, which is the right
 * guard against a person tapping a button four times. It counts `queued` and
 * `running` rows, and nothing ever moves a row out of those states except the
 * worker that owns it. So a worker killed mid-export — a timeout, a redeploy, a
 * platform restart — leaves a row that says "running" forever.
 *
 * Two of those and every export that account ever attempts again is refused
 * before a job is created. The client sees "Edge Function returned a non-2xx
 * status code", which names neither the cause nor the fix, and the state is
 * permanent: nothing in the system was ever going to clear it.
 *
 * Production is one row away from that right now — a PDF job has been "running"
 * since the thirteenth. This closes both halves: dead rows are reaped, and a
 * finished export is handed back rather than run again.
 */

/**
 * Jobs no worker is coming back for.
 *
 * Fifteen minutes is far past any real export — the slowest template in the
 * catalogue clones in under a second — so anything older has no owner. Marked
 * failed rather than deleted: a person who wondered why their download stopped
 * deserves to find the row that says so.
 */
create or replace function public.reap_stale_export_jobs(p_owner_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reaped integer;
begin
  update public.export_jobs
  set status = 'failed'::public.job_status,
      error_message = coalesce(error_message, 'Fayl tayyorlash vaqti tugadi. Qayta urinib ko''ring.'),
      completed_at = coalesce(completed_at, now())
  where status in ('queued'::public.job_status, 'running'::public.job_status)
    and created_at < now() - interval '15 minutes'
    and (p_owner_id is null or owner_id = p_owner_id);

  get diagnostics v_reaped = row_count;
  return v_reaped;
end;
$$;

revoke all on function public.reap_stale_export_jobs(uuid) from public, anon, authenticated;

create or replace function public.request_export(
  p_presentation_id uuid,
  p_format public.export_format,
  p_options jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_active_jobs integer;
  v_changed_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- PNG remains in the historical enum so old rows and clients do not break,
  -- but it is no longer a user-facing or queueable export format.
  if p_format not in ('pdf'::public.export_format, 'pptx'::public.export_format) then
    raise exception 'export format must be pdf or pptx' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_options, '{}'::jsonb)) <> 'object' then
    raise exception 'export options must be an object' using errcode = '22023';
  end if;

  select updated_at into v_changed_at
  from public.presentations
  where id = p_presentation_id
    and owner_id = v_user_id
    and status = 'ready';

  if not found then
    raise exception 'ready presentation not found' using errcode = 'P0002';
  end if;

  -- Serialise queue admission per account so rapid taps cannot race the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  -- Inside the lock, so two taps cannot both decide the queue is clear.
  perform public.reap_stale_export_jobs(v_user_id);

  /**
   * The file this deck already has, when it still describes this deck.
   *
   * A second tap on a button that already produced a file should hand back the
   * file, not spend another worker and another minute making an identical one.
   * "Still describes" is the whole condition: an export finished before the
   * deck was last edited is a picture of something that no longer exists, so it
   * is ignored and a new one is made.
   */
  select id into v_job_id
  from public.export_jobs
  where owner_id = v_user_id
    and presentation_id = p_presentation_id
    and format = p_format
    and status = 'succeeded'::public.job_status
    and storage_path is not null
    and (expires_at is null or expires_at > now() + interval '2 minutes')
    and completed_at >= v_changed_at
  order by completed_at desc
  limit 1;

  if v_job_id is not null then
    return v_job_id;
  end if;

  -- And a job for this deck that is genuinely still running is that tap's
  -- answer too, rather than a second worker racing the first.
  select id into v_job_id
  from public.export_jobs
  where owner_id = v_user_id
    and presentation_id = p_presentation_id
    and format = p_format
    and status in ('queued'::public.job_status, 'running'::public.job_status)
  order by created_at desc
  limit 1;

  if v_job_id is not null then
    return v_job_id;
  end if;

  select count(*)::integer
    into v_active_jobs
  from public.export_jobs
  where owner_id = v_user_id
    and status in ('queued'::public.job_status, 'running'::public.job_status);

  if v_active_jobs >= 2 then
    raise exception 'too many active export jobs' using errcode = 'P0001';
  end if;

  insert into public.export_jobs (presentation_id, owner_id, format, options)
  values (p_presentation_id, v_user_id, p_format, coalesce(p_options, '{}'::jsonb))
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_export(uuid, public.export_format, jsonb)
  from public, anon;
grant execute on function public.request_export(uuid, public.export_format, jsonb)
  to authenticated;

-- The row that has been running since the thirteenth, and any like it.
select public.reap_stale_export_jobs();
