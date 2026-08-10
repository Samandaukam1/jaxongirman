-- Real presentation export delivery.
--
-- `export_jobs` remains the single job/file record: the existing id,
-- presentation_id, format, storage_path, created_at and expires_at columns are
-- already the metadata contract. These two additions make a completed row
-- sufficient to download the object without inspecting Storage metadata.

alter table public.export_jobs
  add column if not exists size_bytes bigint,
  add column if not exists file_name text;

alter table public.export_jobs
  drop constraint if exists export_jobs_size_bytes_nonnegative,
  add constraint export_jobs_size_bytes_nonnegative
    check (size_bytes is null or size_bytes >= 0),
  drop constraint if exists export_jobs_file_name_safe,
  add constraint export_jobs_file_name_safe
    check (
      file_name is null or (
        char_length(file_name) between 5 and 160
        and file_name !~ '[\\/[:cntrl:]]'
      )
    ),
  drop constraint if exists export_jobs_storage_owner_prefix,
  add constraint export_jobs_storage_owner_prefix
    check (storage_path is null or storage_path like owner_id::text || '/%');

create index if not exists export_jobs_owner_status_created_idx
  on public.export_jobs (owner_id, status, created_at desc);

-- The client follows this row while the Edge background task runs. Keep the
-- migration idempotent for projects that enabled it manually during testing.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'export_jobs'
  ) then
    alter publication supabase_realtime add table public.export_jobs;
  end if;
end
$$;

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

  if not exists (
    select 1
    from public.presentations
    where id = p_presentation_id
      and owner_id = v_user_id
      and status = 'ready'
  ) then
    raise exception 'ready presentation not found' using errcode = 'P0002';
  end if;

  -- Serialise queue admission per account so rapid taps cannot race the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

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
  to authenticated, service_role;

