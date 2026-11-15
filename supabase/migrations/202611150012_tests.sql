-- Tests to print and check (Jaxongirman.app 2.0, §5.2).
--
-- A test is single-answer multiple choice: 3, 4 or 5 options, one right, up to
-- sixty questions — what fits one answer sheet (supabase/functions/_shared/
-- test-sheet.ts). It is printed with its answer sheet and checked by scanning
-- the filled-in sheet or by entering the answers by hand. The count of options
-- is chosen when the test is made and is the same for every question, because
-- the printed sheet has that many bubbles in every row.
--
-- A result is graded here, from the answers it was given, against the key as
-- it is now; the app cannot hand in a score.

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 160),
  description text not null default '' check (char_length(description) <= 2000),
  language text not null default 'uz' check (language in ('uz', 'en', 'ru', 'tr')),
  source_type text not null default 'manual' check (source_type in ('ai', 'text', 'presentation', 'manual')),
  source_presentation_id uuid references public.presentations(id) on delete set null,
  difficulty text not null default 'aralash' check (difficulty in ('oson', 'ortacha', 'qiyin', 'aralash')),
  audience text not null default 'umumiy' check (char_length(audience) <= 40),
  option_count integer not null default 4 check (option_count between 3 and 5),
  print_layout text not null default 'combined' check (print_layout in ('combined', 'separate')),
  status text not null default 'draft' check (status in ('generating', 'draft', 'ready', 'failed')),
  question_count integer not null default 0 check (question_count between 0 and 60),
  failure_reason text,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tests_owner_idx on public.tests (owner_id, updated_at desc);

create table if not exists public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null default '' check (char_length(prompt) <= 1000),
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 3 and 5),
  correct integer not null default 0 check (correct between 0 and 4),
  explanation text not null default '' check (char_length(explanation) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists test_questions_test_idx on public.test_questions (test_id, position);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null default '' check (char_length(student_name) <= 120),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  score integer not null check (score >= 0),
  total integer not null check (total >= 0),
  source text not null default 'scan' check (source in ('scan', 'manual')),
  created_at timestamptz not null default now()
);
create index if not exists test_results_test_idx on public.test_results (test_id, created_at desc);

drop trigger if exists tests_updated_at on public.tests;
create trigger tests_updated_at before update on public.tests for each row execute function public.set_updated_at();
drop trigger if exists test_questions_updated_at on public.test_questions;
create trigger test_questions_updated_at before update on public.test_questions for each row execute function public.set_updated_at();

/** A question has as many options as its test, its answer among them, and its owner is the test's. */
create or replace function public.test_question_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
begin
  select * into v_test from public.tests where id = new.test_id;
  if not found or v_test.owner_id is distinct from new.owner_id then
    raise exception 'test not found' using errcode = '42501';
  end if;
  if jsonb_array_length(new.options) <> v_test.option_count then
    raise exception 'Har bir savolda % ta variant bo‘lishi kerak.', v_test.option_count using errcode = '22023';
  end if;
  if new.correct >= v_test.option_count then
    raise exception 'To‘g‘ri javob variantlar orasida bo‘lishi kerak.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists test_questions_guard on public.test_questions;
create trigger test_questions_guard before insert or update on public.test_questions
  for each row execute function public.test_question_guard();

create or replace function public.test_sync_question_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.tests set question_count = question_count + 1 where id = new.test_id;
    return new;
  end if;
  update public.tests set question_count = greatest(question_count - 1, 0) where id = old.test_id;
  return old;
end;
$$;
drop trigger if exists test_questions_count on public.test_questions;
create trigger test_questions_count after insert or delete on public.test_questions
  for each row execute function public.test_sync_question_count();

-- The sheet has as many bubbles in a row as the test has options: that is
-- not something to change once questions exist.
create or replace function public.test_option_count_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.option_count is distinct from old.option_count and old.question_count > 0 then
    raise exception 'Savollar bor testda variantlar sonini o‘zgartirib bo‘lmaydi.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists tests_option_count_guard on public.tests;
create trigger tests_option_count_guard before update on public.tests
  for each row execute function public.test_option_count_guard();

alter table public.tests enable row level security;
alter table public.test_questions enable row level security;
alter table public.test_results enable row level security;

drop policy if exists tests_owner_all on public.tests;
create policy tests_owner_all on public.tests for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists test_questions_owner_all on public.test_questions;
create policy test_questions_owner_all on public.test_questions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists test_results_owner_read on public.test_results;
create policy test_results_owner_read on public.test_results for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists test_results_owner_delete on public.test_results;
create policy test_results_owner_delete on public.test_results for delete to authenticated
  using (owner_id = (select auth.uid()));
-- A result is written only by test_save_result, which grades it.
revoke insert, update on public.test_results from anon, authenticated;

/**
 * A student's sheet, graded and kept. `p_answers` holds one entry per
 * question in order: the option's index, or null for none.
 */
create or replace function public.test_save_result(
  p_test_id uuid,
  p_student_name text,
  p_answers jsonb,
  p_source text default 'scan'
)
returns public.test_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_test public.tests%rowtype;
  v_score integer;
  v_row public.test_results%rowtype;
begin
  select * into v_test from public.tests where id = p_test_id;
  if not found or v_test.owner_id is distinct from v_user then
    raise exception 'test not found' using errcode = 'P0002';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_test.question_count then
    raise exception 'Javoblar soni savollar soniga teng bo‘lishi kerak.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_answers) as answer
    where jsonb_typeof(answer) not in ('null', 'number')
       or (jsonb_typeof(answer) = 'number' and ((answer #>> '{}')::numeric not between 0 and v_test.option_count - 1
                                               or (answer #>> '{}')::numeric <> floor((answer #>> '{}')::numeric)))
  ) then
    raise exception 'Javob variantlar orasida bo‘lishi kerak.' using errcode = '22023';
  end if;

  -- By order, not by the stored position: a deleted question leaves a gap in
  -- the numbers but not on the printed sheet.
  select count(*) into v_score
    from (
      select q.correct, (row_number() over (order by q.position, q.created_at, q.id) - 1)::integer as at
        from public.test_questions q
       where q.test_id = p_test_id
    ) ordered
   where jsonb_typeof(p_answers -> ordered.at) = 'number'
     and (p_answers ->> ordered.at)::integer = ordered.correct;

  insert into public.test_results (test_id, owner_id, student_name, answers, score, total, source)
  values (p_test_id, v_user, left(btrim(coalesce(p_student_name, '')), 120), p_answers, v_score, v_test.question_count,
          case when p_source = 'manual' then 'manual' else 'scan' end)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.test_save_result(uuid, text, jsonb, text) from public, anon;
grant execute on function public.test_save_result(uuid, text, jsonb, text) to authenticated;

-- What the app may touch: its own words and choices, never the status, the
-- counts or a failure the generator wrote.
grant select, delete on public.tests to authenticated;
grant insert (id, owner_id, title, description, language, source_type, difficulty, audience, option_count, print_layout)
  on public.tests to authenticated;
grant update (title, description, print_layout) on public.tests to authenticated;
grant select, insert, update, delete on public.test_questions to authenticated;
grant select, delete on public.test_results to authenticated;
