/**
 * No generation stays running for ever, and no reservation is stranded with it.
 *
 * A job whose worker died — an edge function that ran out of wall clock, a
 * Gemini call that never answered before there was a timeout on one — left the
 * row saying `running` and the author's credits saying `reserved`. Nothing
 * swept it up, because nothing was watching: `fail_generation` has always
 * released the reservation correctly, and nobody was calling it.
 *
 * Everything here is additive. No existing row changes meaning, and running the
 * migration twice does nothing the second time.
 */

/* ------------------------------------------------- per-stage measurements */

alter table public.generation_steps
  -- How long the stage took, kept beside the stage rather than derived from two
  -- timestamps by every reader that wants it.
  add column if not exists duration_ms integer,
  -- The stable code, next to the sentence written for the author. A message is
  -- for a person; a code is what a query groups by when the same stage starts
  -- failing across many decks.
  add column if not exists error_code text;

comment on column public.generation_steps.duration_ms is
  'Wall time for this stage. Written when the stage ends, successfully or not.';
comment on column public.generation_steps.error_code is
  'Stable failure code — timeout, rate_limited, http_5xx — never a provider sentence.';

/* -------------------------------------------------------------- watchdog */

/**
 * Fails jobs that have stopped moving, and gives the credits back.
 *
 * "Stopped moving" is measured from `heartbeat_at`, which every stage change
 * updates, rather than from `created_at`: a long deck that is still working is
 * not stale, and a short one that died at ten seconds is. The default window is
 * deliberately well past the slowest healthy run observed (a little over two
 * minutes) so a working generation is never killed under the author.
 *
 * Delegates to `fail_generation` rather than writing the wallet itself. That
 * function already holds the row locks, writes the ledger entry and refuses to
 * refund a job that already ended — three things this must not reimplement.
 */
create or replace function public.fail_stale_generations(p_stale_minutes integer default 8)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_count integer := 0;
  v_cutoff timestamptz := now() - make_interval(mins => greatest(p_stale_minutes, 1));
begin
  for v_job in
    select id, stage
    from public.generation_jobs
    where status in ('running', 'queued')
      and coalesce(heartbeat_at, started_at, created_at) < v_cutoff
    order by created_at
    limit 100
  loop
    perform public.fail_generation(
      v_job.id,
      'stalled',
      format('Generatsiya %s bosqichida to''xtab qoldi va bekor qilindi.', coalesce(v_job.stage, 'noma''lum'))
    );

    -- The step the job died on is left saying "running" otherwise, so the
    -- author's progress list keeps a spinner on a stage nothing is working on.
    update public.generation_steps
      set status = 'failed',
          error_code = 'stalled',
          message = coalesce(message, 'Bosqich to''xtab qoldi.'),
          completed_at = now()
      where job_id = v_job.id and status = 'running';

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.fail_stale_generations(integer) is
  'Fails generation jobs whose heartbeat has stopped and releases their credit reservation. Idempotent.';

revoke all on function public.fail_stale_generations(integer) from public, anon, authenticated;
grant execute on function public.fail_stale_generations(integer) to service_role;
