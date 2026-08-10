-- Ma'lumotlarni yig'ish — the data collection module.
--
-- Two rules shape this schema more than anything else:
--
--   1. An abandoned form leaves nothing behind. There is no draft table and no
--      per-answer insert path; a response exists only because
--      submit_survey_response() wrote every one of its answers in a single
--      transaction. Walk away mid-form and the server never heard of you.
--
--   2. Answers are temporary, questions are not. Every response carries an
--      expires_at and is swept after it; the creator's question sets live on as
--      reusable templates. Retention is a real, stated window — not a claim that
--      nothing is ever stored.

create type public.survey_status as enum ('draft', 'open', 'closed');
create type public.survey_question_type as enum (
  'short_text', 'long_text', 'phone', 'image', 'single_choice', 'multi_choice', 'date', 'number'
);
create type public.survey_participant_status as enum ('invited', 'viewed', 'submitted');

-- ------------------------------------------------------------- text rules --
/**
 * True when every character belongs to the Latin writing system as Uzbek uses
 * it — ASCII, the Latin supplements, and the apostrophe/quote/dash variants that
 * O‘zbek keyboards emit for O‘ and G‘. Cyrillic, Arabic, CJK and emoji all fail.
 *
 * Immutable and character-class based rather than a per-alphabet blocklist: a
 * new alphabet does not need a new rule to be rejected.
 */
create or replace function public.is_latin_text(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
      or btrim(p_value) = ''
      or p_value !~ '[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u024F\u02B9\u02BB\u02BC\u02BD\u2013\u2014\u2018\u2019\u201C\u201D\u2026]';
$$;

comment on function public.is_latin_text(text) is
  'True when the value contains only Latin-script characters, including the O‘/G‘ apostrophe variants.';

/**
 * Uzbekistan numbers, stored one way. Accepts what a person types — spaces,
 * brackets, a leading 998 or a bare nine digits — and answers with the single
 * normalized form +998XXXXXXXXX, or null when it is not a valid number.
 */
create or replace function public.normalize_uz_phone(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  v_digits := regexp_replace(p_value, '[^0-9]', '', 'g');
  if char_length(v_digits) = 9 then v_digits := '998' || v_digits; end if;
  if char_length(v_digits) = 12 and left(v_digits, 3) = '998' then return '+' || v_digits; end if;
  return null;
end;
$$;

comment on function public.normalize_uz_phone(text) is
  'Normalizes an Uzbek phone number to +998XXXXXXXXX, or null when it is not one.';

-- ----------------------------------------------------------------- forms --
create table public.survey_forms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  status public.survey_status not null default 'draft',
  deadline timestamptz,
  expected_participants integer,
  privacy_note text not null default '',
  -- Copied from configuration at publish time, so changing the platform default
  -- never silently shortens or extends a window respondents were told about.
  response_retention_hours integer not null default 48,
  -- Denormalized so a respondent can see "24/30 javob" without being able to
  -- read a single response row. Maintained by trigger, never by a client.
  submitted_count integer not null default 0,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint survey_forms_title_length check (char_length(btrim(title)) between 3 and 120),
  constraint survey_forms_description_length check (char_length(description) <= 1000),
  constraint survey_forms_privacy_length check (char_length(privacy_note) <= 600),
  constraint survey_forms_expected check (expected_participants is null or expected_participants between 1 and 100000),
  constraint survey_forms_retention check (response_retention_hours between 1 and 720),
  constraint survey_forms_counts check (submitted_count >= 0)
);

create index survey_forms_owner_idx on public.survey_forms (owner_id, created_at desc);
create index survey_forms_deadline_idx on public.survey_forms (deadline) where status = 'open';

create trigger survey_forms_set_updated_at
  before update on public.survey_forms
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- questions --
create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  position integer not null,
  type public.survey_question_type not null,
  label text not null,
  helper_text text not null default '',
  is_required boolean not null default true,
  -- Only meaningful for free text. A phone, a number or a date has its own
  -- format rule; forcing an alphabet on them would reject valid answers.
  latin_only boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (form_id, position),
  constraint survey_questions_label_length check (char_length(btrim(label)) between 1 and 200),
  constraint survey_questions_helper_length check (char_length(helper_text) <= 300),
  constraint survey_questions_position check (position >= 0),
  constraint survey_questions_latin_scope check (
    latin_only = false or type in ('short_text'::public.survey_question_type, 'long_text'::public.survey_question_type)
  )
);

create index survey_questions_form_idx on public.survey_questions (form_id, position);

create table public.survey_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  position integer not null,
  label text not null,
  unique (question_id, position),
  constraint survey_options_label_length check (char_length(btrim(label)) between 1 and 160),
  constraint survey_options_position check (position >= 0)
);

create index survey_question_options_question_idx on public.survey_question_options (question_id, position);

-- ---------------------------------------------------------- participants --
create table public.survey_participants (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.survey_participant_status not null default 'viewed',
  first_viewed_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (form_id, user_id)
);

create index survey_participants_user_idx on public.survey_participants (user_id, first_viewed_at desc);

-- ------------------------------------------------------------- responses --
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  respondent_id uuid not null references auth.users(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  -- The retention promise, written into the row itself so the sweep needs no
  -- knowledge of what the form was configured with when it was answered.
  expires_at timestamptz not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (form_id, respondent_id),
  unique (form_id, idempotency_key)
);

create index survey_responses_form_idx on public.survey_responses (form_id, submitted_at desc);
create index survey_responses_expiry_idx on public.survey_responses (expires_at);

create table public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  value_text text,
  value_number numeric(20,6),
  value_date date,
  selected_option_ids uuid[] not null default '{}',
  unique (response_id, question_id),
  constraint survey_answers_text_length check (value_text is null or char_length(value_text) <= 5000)
);

create index survey_answers_question_idx on public.survey_answers (question_id);
create index survey_answers_response_idx on public.survey_answers (response_id);

create table public.survey_answer_files (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.survey_answers(id) on delete cascade,
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  bucket_id text not null default 'survey-uploads',
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint survey_answer_files_size check (size_bytes > 0 and size_bytes <= 3145728),
  constraint survey_answer_files_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp'))
);

create index survey_answer_files_response_idx on public.survey_answer_files (response_id);

-- ------------------------------------------------------------- templates --
/**
 * A creator's saved question set. This is the half of the module that is meant
 * to persist: the questions someone spent time writing, never the answers other
 * people gave to them.
 */
create table public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint survey_templates_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint survey_templates_description_length check (char_length(description) <= 500)
);

create index survey_templates_owner_idx on public.survey_templates (owner_id, updated_at desc);

create trigger survey_templates_set_updated_at
  before update on public.survey_templates
  for each row execute function public.set_updated_at();

create table public.survey_template_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.survey_templates(id) on delete cascade,
  position integer not null,
  type public.survey_question_type not null,
  label text not null,
  helper_text text not null default '',
  is_required boolean not null default true,
  latin_only boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  -- Options ride along as an ordered array of labels: a template is a shape to
  -- copy, not a live question with its own answerable identity.
  options jsonb not null default '[]'::jsonb,
  unique (template_id, position),
  constraint survey_template_questions_label check (char_length(btrim(label)) between 1 and 200),
  constraint survey_template_questions_helper check (char_length(helper_text) <= 300),
  constraint survey_template_questions_options check (jsonb_typeof(options) = 'array')
);

create index survey_template_questions_template_idx on public.survey_template_questions (template_id, position);

-- --------------------------------------------------------------- exports --
create table public.survey_exports (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.survey_forms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  format text not null,
  storage_path text not null,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint survey_exports_format check (format in ('xlsx', 'csv'))
);

create index survey_exports_form_idx on public.survey_exports (form_id, created_at desc);

-- ------------------------------------------------- privacy purge audit --
/**
 * What the sweep removed, counted but never quoted. Deliberately holds no
 * answer text, no file, and no respondent id — the point of the sweep is that
 * those are gone.
 */
create table public.survey_purge_audit (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references public.survey_forms(id) on delete set null,
  responses_purged integer not null default 0,
  files_purged integer not null default 0,
  purged_at timestamptz not null default now()
);

create index survey_purge_audit_purged_idx on public.survey_purge_audit (purged_at desc);

-- ------------------------------------------------------ membership helpers --
-- Security definer, so an RLS policy on one survey table may ask about another
-- without the two policies referring to each other in a circle.
create or replace function public.survey_is_owner(p_form_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.survey_forms f where f.id = p_form_id and f.owner_id = p_user_id);
$$;

create or replace function public.survey_is_participant(p_form_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.survey_participants p where p.form_id = p_form_id and p.user_id = p_user_id);
$$;

/** Owner of the form, or the person who wrote it. Nobody else, admins included. */
create or replace function public.survey_can_read_response(p_response_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.survey_responses r
    join public.survey_forms f on f.id = r.form_id
    where r.id = p_response_id and (r.respondent_id = p_user_id or f.owner_id = p_user_id)
  );
$$;

-- --------------------------------------------------------- response count --
/** Keeps survey_forms.submitted_count true without exposing response rows. */
create or replace function public.survey_sync_submitted_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.survey_forms set submitted_count = submitted_count + 1 where id = new.form_id;
    return new;
  end if;
  update public.survey_forms set submitted_count = greatest(submitted_count - 1, 0) where id = old.form_id;
  return old;
end;
$$;

create trigger survey_responses_count_insert
  after insert on public.survey_responses
  for each row execute function public.survey_sync_submitted_count();
create trigger survey_responses_count_delete
  after delete on public.survey_responses
  for each row execute function public.survey_sync_submitted_count();

-- ------------------------------------------------------------------- RLS --
alter table public.survey_forms enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_question_options enable row level security;
alter table public.survey_participants enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;
alter table public.survey_answer_files enable row level security;
alter table public.survey_templates enable row level security;
alter table public.survey_template_questions enable row level security;
alter table public.survey_exports enable row level security;
alter table public.survey_purge_audit enable row level security;

-- Forms and questions: the creator, anyone who has opened the link, and — for
-- moderation of the *form* only — an admin.
create policy survey_forms_select on public.survey_forms for select to authenticated
  using (owner_id = (select auth.uid()) or public.survey_is_participant(id) or (select public.is_admin()));
create policy survey_forms_insert on public.survey_forms for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy survey_forms_update on public.survey_forms for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy survey_forms_delete on public.survey_forms for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy survey_questions_select on public.survey_questions for select to authenticated
  using (public.survey_is_owner(form_id) or public.survey_is_participant(form_id) or (select public.is_admin()));
create policy survey_questions_write on public.survey_questions for all to authenticated
  using (public.survey_is_owner(form_id)) with check (public.survey_is_owner(form_id));

create policy survey_options_select on public.survey_question_options for select to authenticated
  using (exists (
    select 1 from public.survey_questions q
    where q.id = question_id
      and (public.survey_is_owner(q.form_id) or public.survey_is_participant(q.form_id) or (select public.is_admin()))
  ));
create policy survey_options_write on public.survey_question_options for all to authenticated
  using (exists (select 1 from public.survey_questions q where q.id = question_id and public.survey_is_owner(q.form_id)))
  with check (exists (select 1 from public.survey_questions q where q.id = question_id and public.survey_is_owner(q.form_id)));

create policy survey_participants_select on public.survey_participants for select to authenticated
  using (user_id = (select auth.uid()) or public.survey_is_owner(form_id));

-- Answers. No admin clause anywhere below: moderation of this module works on
-- counts and reports, never on what a person wrote.
create policy survey_responses_select on public.survey_responses for select to authenticated
  using (respondent_id = (select auth.uid()) or public.survey_is_owner(form_id));
create policy survey_answers_select on public.survey_answers for select to authenticated
  using (public.survey_can_read_response(response_id));
create policy survey_answer_files_select on public.survey_answer_files for select to authenticated
  using (public.survey_can_read_response(response_id));

create policy survey_templates_all on public.survey_templates for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy survey_template_questions_all on public.survey_template_questions for all to authenticated
  using (exists (select 1 from public.survey_templates t where t.id = template_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.survey_templates t where t.id = template_id and t.owner_id = (select auth.uid())));

create policy survey_exports_select on public.survey_exports for select to authenticated
  using (owner_id = (select auth.uid()));

create policy survey_purge_audit_select on public.survey_purge_audit for select to authenticated
  using ((select public.is_admin()));

-- Table privileges are granted explicitly in this schema; RLS alone would leave
-- every table above unreadable. Responses and answers are select-only for
-- everyone: the sole write path is submit_survey_response().
grant select on public.survey_forms, public.survey_questions, public.survey_question_options,
  public.survey_participants, public.survey_responses, public.survey_answers,
  public.survey_answer_files, public.survey_exports, public.survey_purge_audit to authenticated;
grant insert, update, delete on public.survey_forms to authenticated;
grant insert, update, delete on public.survey_questions, public.survey_question_options to authenticated;
grant select, insert, update, delete on public.survey_templates, public.survey_template_questions to authenticated;

revoke all on public.survey_forms, public.survey_questions, public.survey_question_options,
  public.survey_participants, public.survey_responses, public.survey_answers,
  public.survey_answer_files, public.survey_templates, public.survey_template_questions,
  public.survey_exports, public.survey_purge_audit from anon;

-- --------------------------------------------------------------- storage --
-- 3 MB, images only, private. The limit is enforced here, in the submit RPC and
-- in the app, because a client-side check is a courtesy and not a control.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-uploads', 'survey-uploads', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path shape is <respondent_id>/<form_id>/<file>. The first segment is who may
-- write, the second is which owner may read.
create policy survey_uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'survey-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy survey_uploads_delete on storage.objects for delete to authenticated
  using (bucket_id = 'survey-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy survey_uploads_select on storage.objects for select to authenticated
  using (
    bucket_id = 'survey-uploads'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.survey_is_owner(nullif((storage.foldername(name))[2], '')::uuid)
    )
  );

-- ------------------------------------------------------------ access state --
/**
 * Everything a screen needs to describe module access truthfully in one call:
 * whether this person holds it, when it ends, what it costs, whether the rule is
 * currently enforced, and whether a payment provider exists at all.
 */
create or replace function public.module_access_state(p_module_code text default 'data_collection')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config jsonb;
  v_payments jsonb;
  v_entitlement public.module_entitlements%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select coalesce(value, '{}'::jsonb) into v_config from public.app_settings where key = 'modules.' || p_module_code;
  if v_config is null then
    raise exception 'unknown module %', p_module_code using errcode = '22023';
  end if;
  select coalesce(value, '{}'::jsonb) into v_payments from public.app_settings where key = 'payments.config';

  select * into v_entitlement from public.module_entitlements
    where user_id = auth.uid() and module_code = p_module_code and status = 'active'
      and starts_at <= now() and expires_at > now();

  return jsonb_build_object(
    'module_code', p_module_code,
    'label', v_config ->> 'label',
    'enabled', coalesce((v_config ->> 'enabled')::boolean, true),
    'price_amount', coalesce((v_config ->> 'price_amount')::numeric, 0),
    'currency', coalesce(v_config ->> 'currency', 'UZS'),
    'duration_months', coalesce((v_config ->> 'duration_months')::integer, 11),
    'retention_hours', coalesce((v_config ->> 'response_retention_hours')::integer, 48),
    'max_image_bytes', coalesce((v_config ->> 'max_image_bytes')::integer, 3145728),
    'enforce_creator_access', coalesce((v_config ->> 'enforce_creator_access')::boolean, false),
    'enforce_respondent_access', coalesce((v_config ->> 'enforce_respondent_access')::boolean, false),
    'has_access', v_entitlement.id is not null,
    'expires_at', v_entitlement.expires_at,
    'payment_configured', coalesce((v_payments ->> 'configured')::boolean, false),
    'payment_provider', v_payments ->> 'provider'
  );
end;
$$;

/** Raises unless this person may act on the module. One place, both roles. */
create or replace function public.assert_module_access(p_module_code text, p_role text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config jsonb;
  v_enforced boolean;
begin
  select coalesce(value, '{}'::jsonb) into v_config from public.app_settings where key = 'modules.' || p_module_code;
  if v_config is null then
    raise exception 'unknown module %', p_module_code using errcode = '22023';
  end if;
  if not coalesce((v_config ->> 'enabled')::boolean, true) then
    raise exception 'module is disabled' using errcode = '42501';
  end if;

  v_enforced := case p_role
    when 'creator' then coalesce((v_config ->> 'enforce_creator_access')::boolean, false)
    else coalesce((v_config ->> 'enforce_respondent_access')::boolean, false)
  end;

  if v_enforced and not public.has_module_access(p_module_code, auth.uid()) then
    raise exception 'module access required' using errcode = '42501';
  end if;
end;
$$;

-- ------------------------------------------------------- survey authoring --
/**
 * Creates or rewrites a survey and its whole question set in one transaction.
 *
 * Questions may only be replaced while no one has answered: an answer row points
 * at a question id, and rewriting the set under it would leave results that no
 * longer mean what they say. After the first response, only the title,
 * description, deadline and privacy note remain editable.
 */
create or replace function public.save_survey_form(
  p_form_id uuid,
  p_title text,
  p_description text default '',
  p_deadline timestamptz default null,
  p_expected_participants integer default null,
  p_privacy_note text default '',
  p_questions jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_config jsonb;
  v_max_questions integer;
  v_form public.survey_forms%rowtype;
  v_question jsonb;
  v_question_id uuid;
  v_option jsonb;
  v_index integer := 0;
  v_option_index integer;
  v_type public.survey_question_type;
  v_latin boolean;
  v_count integer;
begin
  if v_owner is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform public.assert_module_access('data_collection', 'creator');

  select coalesce(value, '{}'::jsonb) into v_config from public.app_settings where key = 'modules.data_collection';
  v_max_questions := coalesce((v_config ->> 'max_questions')::integer, 40);

  if p_deadline is not null and p_deadline <= now() then
    raise exception 'deadline must be in the future' using errcode = '22023';
  end if;

  if p_form_id is null then
    insert into public.survey_forms (
      owner_id, title, description, deadline, expected_participants, privacy_note, response_retention_hours
    ) values (
      v_owner, btrim(p_title), left(btrim(coalesce(p_description, '')), 1000), p_deadline, p_expected_participants,
      left(btrim(coalesce(p_privacy_note, '')), 600),
      coalesce((v_config ->> 'response_retention_hours')::integer, 48)
    )
    returning * into v_form;
  else
    select * into v_form from public.survey_forms where id = p_form_id for update;
    if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;
    if v_form.owner_id <> v_owner then raise exception 'only the owner may edit this survey' using errcode = '42501'; end if;

    update public.survey_forms set
      title = btrim(p_title),
      description = left(btrim(coalesce(p_description, '')), 1000),
      deadline = p_deadline,
      expected_participants = p_expected_participants,
      privacy_note = left(btrim(coalesce(p_privacy_note, '')), 600)
      where id = v_form.id
      returning * into v_form;
  end if;

  if p_questions is null then
    return v_form.id;
  end if;

  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions must be an array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_questions);
  if v_count < 1 then raise exception 'a survey needs at least one question' using errcode = '22023'; end if;
  if v_count > v_max_questions then
    raise exception 'a survey may hold at most % questions', v_max_questions using errcode = '22023';
  end if;
  if v_form.submitted_count > 0 then
    raise exception 'questions cannot change after the first response' using errcode = '42501';
  end if;

  delete from public.survey_questions where form_id = v_form.id;

  for v_question in select * from jsonb_array_elements(p_questions) loop
    v_type := (v_question ->> 'type')::public.survey_question_type;
    v_latin := coalesce((v_question ->> 'latin_only')::boolean, false)
      and v_type in ('short_text'::public.survey_question_type, 'long_text'::public.survey_question_type);

    insert into public.survey_questions (form_id, position, type, label, helper_text, is_required, latin_only, config)
    values (
      v_form.id, v_index, v_type, btrim(v_question ->> 'label'),
      left(btrim(coalesce(v_question ->> 'helper_text', '')), 300),
      coalesce((v_question ->> 'is_required')::boolean, true),
      v_latin,
      coalesce(v_question -> 'config', '{}'::jsonb)
    )
    returning id into v_question_id;

    if v_type in ('single_choice'::public.survey_question_type, 'multi_choice'::public.survey_question_type) then
      v_option_index := 0;
      for v_option in select * from jsonb_array_elements(coalesce(v_question -> 'options', '[]'::jsonb)) loop
        insert into public.survey_question_options (question_id, position, label)
        values (v_question_id, v_option_index, btrim(v_option ->> 'label'));
        v_option_index := v_option_index + 1;
      end loop;
      if v_option_index < 2 then
        raise exception 'a choice question needs at least two options' using errcode = '22023';
      end if;
    end if;

    v_index := v_index + 1;
  end loop;

  return v_form.id;
end;
$$;

/** Opens or closes a survey. Opening requires questions and a future deadline. */
create or replace function public.set_survey_status(p_form_id uuid, p_status public.survey_status)
returns public.survey_forms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_form public.survey_forms%rowtype;
  v_questions integer;
begin
  select * into v_form from public.survey_forms where id = p_form_id for update;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;
  if v_form.owner_id <> v_owner then raise exception 'only the owner may change this survey' using errcode = '42501'; end if;

  if p_status = 'open' then
    perform public.assert_module_access('data_collection', 'creator');
    select count(*) into v_questions from public.survey_questions where form_id = p_form_id;
    if v_questions = 0 then raise exception 'add at least one question before opening' using errcode = '22023'; end if;
    if v_form.deadline is not null and v_form.deadline <= now() then
      raise exception 'set a future deadline before opening' using errcode = '22023';
    end if;
    update public.survey_forms
      set status = 'open', opened_at = coalesce(v_form.opened_at, now()), closed_at = null
      where id = p_form_id returning * into v_form;
  elsif p_status = 'closed' then
    update public.survey_forms set status = 'closed', closed_at = now() where id = p_form_id returning * into v_form;
  else
    if v_form.submitted_count > 0 then
      raise exception 'a survey with responses cannot return to draft' using errcode = '42501';
    end if;
    update public.survey_forms set status = 'draft', opened_at = null, closed_at = null
      where id = p_form_id returning * into v_form;
  end if;

  return v_form;
end;
$$;

-- ------------------------------------------------------- respondent view --
/**
 * Opens a survey from its deep link. Registers the caller as a participant —
 * which is also what grants them RLS visibility of the form and its questions —
 * and answers with everything needed to render it, plus whether they already
 * submitted. Never returns anyone else's answers.
 */
create or replace function public.open_survey(p_form_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_form public.survey_forms%rowtype;
  v_questions jsonb;
  v_submitted timestamptz;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_form from public.survey_forms where id = p_form_id;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;

  if v_form.owner_id <> v_user then
    if v_form.status <> 'open' then
      raise exception 'survey is not open' using errcode = '42501';
    end if;
    perform public.assert_module_access('data_collection', 'respondent');

    insert into public.survey_participants (form_id, user_id, status)
    values (p_form_id, v_user, 'viewed')
    on conflict (form_id, user_id) do nothing;
  end if;

  select submitted_at into v_submitted from public.survey_responses
    where form_id = p_form_id and respondent_id = v_user;

  select coalesce(jsonb_agg(question order by position), '[]'::jsonb) into v_questions
  from (
    select q.position, jsonb_build_object(
      'id', q.id,
      'type', q.type,
      'label', q.label,
      'helper_text', q.helper_text,
      'is_required', q.is_required,
      'latin_only', q.latin_only,
      'config', q.config,
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position)
        from public.survey_question_options o where o.question_id = q.id
      ), '[]'::jsonb)
    ) as question
    from public.survey_questions q
    where q.form_id = p_form_id
  ) ordered;

  return jsonb_build_object(
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'description', v_form.description,
      'status', v_form.status,
      'deadline', v_form.deadline,
      'privacy_note', v_form.privacy_note,
      'retention_hours', v_form.response_retention_hours,
      'expected_participants', v_form.expected_participants,
      'submitted_count', v_form.submitted_count,
      'is_owner', v_form.owner_id = v_user,
      'owner_name', (select coalesce(nullif(btrim(full_name), ''), '—') from public.profiles where id = v_form.owner_id)
    ),
    'questions', v_questions,
    'already_submitted_at', v_submitted
  );
end;
$$;

-- ---------------------------------------------------------------- submit --
/**
 * The only way a response reaches the database. Validates every answer against
 * its question — required, alphabet, phone shape, numeric bounds, option
 * membership, file size and ownership — and writes the response, its answers and
 * its file references together or not at all.
 *
 * Because there is no other write path, a form abandoned halfway leaves no row
 * behind: the partial answers only ever existed on the person's device.
 */
create or replace function public.submit_survey_response(
  p_form_id uuid,
  p_answers jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_form public.survey_forms%rowtype;
  v_key text;
  v_existing public.survey_responses%rowtype;
  v_response public.survey_responses%rowtype;
  v_map jsonb;
  v_question public.survey_questions%rowtype;
  v_item jsonb;
  v_text text;
  v_number numeric;
  v_date date;
  v_options uuid[];
  v_valid integer;
  v_answer_id uuid;
  v_file jsonb;
  v_files integer;
  v_max_bytes integer;
  v_config jsonb;
  v_answered boolean;
  v_max_length integer;
  v_min numeric;
  v_max numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  select * into v_form from public.survey_forms where id = p_form_id;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;
  if v_form.status <> 'open' then raise exception 'So‘rovnoma yopilgan.' using errcode = '42501'; end if;
  if v_form.deadline is not null and v_form.deadline <= now() then
    raise exception 'So‘rovnoma muddati tugagan.' using errcode = '42501';
  end if;
  if v_form.owner_id <> v_user then
    perform public.assert_module_access('data_collection', 'respondent');
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Answered already, whether by a real second attempt or a retried request.
  select * into v_existing from public.survey_responses where form_id = p_form_id and respondent_id = v_user;
  if found then
    return jsonb_build_object('applied', false, 'response_id', v_existing.id, 'submitted_at', v_existing.submitted_at);
  end if;

  select coalesce(value, '{}'::jsonb) into v_config from public.app_settings where key = 'modules.data_collection';
  v_max_bytes := coalesce((v_config ->> 'max_image_bytes')::integer, 3145728);

  select jsonb_object_agg(item ->> 'question_id', item) into v_map
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as item
  where item ? 'question_id';
  v_map := coalesce(v_map, '{}'::jsonb);

  insert into public.survey_responses (form_id, respondent_id, expires_at, idempotency_key)
  values (p_form_id, v_user, now() + make_interval(hours => v_form.response_retention_hours), v_key)
  returning * into v_response;

  for v_question in
    select * from public.survey_questions where form_id = p_form_id order by position
  loop
    v_item := v_map -> v_question.id::text;
    v_text := null; v_number := null; v_date := null; v_options := '{}'; v_files := 0;
    v_answered := false;

    if v_item is not null then
      if v_question.type in ('short_text'::public.survey_question_type, 'long_text'::public.survey_question_type) then
        v_text := nullif(btrim(coalesce(v_item ->> 'text', '')), '');
        if v_text is not null then
          if v_question.latin_only and not public.is_latin_text(v_text) then
            raise exception 'Javobni lotin alifbosida kiriting: %', v_question.label using errcode = '22023';
          end if;
          v_max_length := coalesce((v_question.config ->> 'max_length')::integer,
            case when v_question.type = 'short_text'::public.survey_question_type then 200 else 3000 end);
          if char_length(v_text) > v_max_length then
            raise exception 'Javob % ta belgidan oshmasin: %', v_max_length, v_question.label using errcode = '22023';
          end if;
          v_answered := true;
        end if;

      elsif v_question.type = 'phone'::public.survey_question_type then
        if nullif(btrim(coalesce(v_item ->> 'text', '')), '') is not null then
          v_text := public.normalize_uz_phone(v_item ->> 'text');
          if v_text is null then
            raise exception 'Telefon raqamni +998 formatida kiriting: %', v_question.label using errcode = '22023';
          end if;
          v_answered := true;
        end if;

      elsif v_question.type = 'number'::public.survey_question_type then
        if nullif(btrim(coalesce(v_item ->> 'number', '')), '') is not null then
          begin
            v_number := (v_item ->> 'number')::numeric;
          exception when others then
            raise exception 'Raqam kiriting: %', v_question.label using errcode = '22023';
          end;
          v_min := (v_question.config ->> 'min')::numeric;
          v_max := (v_question.config ->> 'max')::numeric;
          if v_min is not null and v_number < v_min then
            raise exception 'Qiymat % dan kichik bo‘lmasin: %', v_min, v_question.label using errcode = '22023';
          end if;
          if v_max is not null and v_number > v_max then
            raise exception 'Qiymat % dan katta bo‘lmasin: %', v_max, v_question.label using errcode = '22023';
          end if;
          v_answered := true;
        end if;

      elsif v_question.type = 'date'::public.survey_question_type then
        if nullif(btrim(coalesce(v_item ->> 'date', '')), '') is not null then
          begin
            v_date := (v_item ->> 'date')::date;
          exception when others then
            raise exception 'Sanani to‘g‘ri kiriting: %', v_question.label using errcode = '22023';
          end;
          v_answered := true;
        end if;

      elsif v_question.type in ('single_choice'::public.survey_question_type, 'multi_choice'::public.survey_question_type) then
        select coalesce(array_agg(value::uuid), '{}') into v_options
          from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as value;
        if array_length(v_options, 1) is not null then
          if v_question.type = 'single_choice'::public.survey_question_type and array_length(v_options, 1) > 1 then
            raise exception 'Faqat bitta variant tanlang: %', v_question.label using errcode = '22023';
          end if;
          select count(*) into v_valid from public.survey_question_options
            where question_id = v_question.id and id = any(v_options);
          if v_valid <> array_length(v_options, 1) then
            raise exception 'Tanlangan variant topilmadi: %', v_question.label using errcode = '22023';
          end if;
          v_answered := true;
        end if;

      elsif v_question.type = 'image'::public.survey_question_type then
        v_files := jsonb_array_length(coalesce(v_item -> 'files', '[]'::jsonb));
        if v_files > 1 then
          raise exception 'Bitta rasm yuklang: %', v_question.label using errcode = '22023';
        end if;
        v_answered := v_files > 0;
      end if;
    end if;

    if v_question.is_required and not v_answered then
      raise exception 'Savolga javob bering: %', v_question.label using errcode = '22023';
    end if;

    if not v_answered then
      continue;
    end if;

    insert into public.survey_answers (response_id, question_id, value_text, value_number, value_date, selected_option_ids)
    values (v_response.id, v_question.id, v_text, v_number, v_date, v_options)
    returning id into v_answer_id;

    if v_question.type = 'image'::public.survey_question_type then
      for v_file in select * from jsonb_array_elements(v_item -> 'files') loop
        -- The uploaded object must live under this person's own folder for this
        -- form. Anything else is a reference to a file they do not own.
        if (v_file ->> 'path') is null
          or (v_file ->> 'path') not like v_user::text || '/' || p_form_id::text || '/%' then
          raise exception 'Rasm manzili noto‘g‘ri: %', v_question.label using errcode = '22023';
        end if;
        if coalesce((v_file ->> 'size_bytes')::integer, 0) > v_max_bytes then
          raise exception 'Rasm hajmi 3 MB dan kichik bo‘lishi kerak.' using errcode = '22023';
        end if;
        insert into public.survey_answer_files (answer_id, response_id, storage_path, mime_type, size_bytes)
        values (
          v_answer_id, v_response.id, v_file ->> 'path',
          coalesce(v_file ->> 'mime_type', 'image/jpeg'),
          greatest(coalesce((v_file ->> 'size_bytes')::integer, 1), 1)
        );
      end loop;
    end if;
  end loop;

  insert into public.survey_participants (form_id, user_id, status, submitted_at)
  values (p_form_id, v_user, 'submitted', now())
  on conflict (form_id, user_id) do update set status = 'submitted', submitted_at = now();

  -- One message to the creator, when the target is reached. A notification per
  -- response would bury the inbox on a thirty-person survey.
  if v_form.expected_participants is not null
     and v_form.submitted_count + 1 >= v_form.expected_participants then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_form.owner_id, 'survey_completed',
      'So‘rovnoma to‘ldi',
      '“' || v_form.title || '” bo‘yicha kutilgan javoblar yig‘ildi. Natijalarni ko‘rib chiqing.',
      jsonb_build_object('form_id', v_form.id, 'submitted', v_form.submitted_count + 1),
      '/(app)/survey/results/' || v_form.id::text,
      v_form.id
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'response_id', v_response.id,
    'submitted_at', v_response.submitted_at,
    'expires_at', v_response.expires_at
  );
end;
$$;

-- --------------------------------------------------------------- results --
/**
 * The owner's dashboard in one call: headline counts plus a per-question
 * aggregate shaped to the question's type. Choice questions come back as
 * counted buckets, numbers as a summary, text and images as row lists.
 */
create or replace function public.survey_results_summary(p_form_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_form public.survey_forms%rowtype;
  v_questions jsonb;
begin
  select * into v_form from public.survey_forms where id = p_form_id;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;
  if v_form.owner_id <> v_user then
    raise exception 'only the owner may read results' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(entry order by position), '[]'::jsonb) into v_questions
  from (
    select q.position, jsonb_build_object(
      'id', q.id,
      'label', q.label,
      'type', q.type,
      'is_required', q.is_required,
      'answered', (select count(*) from public.survey_answers a where a.question_id = q.id),
      'options', case
        when q.type in ('single_choice'::public.survey_question_type, 'multi_choice'::public.survey_question_type) then (
          select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'count', (
            select count(*) from public.survey_answers a where a.question_id = q.id and o.id = any(a.selected_option_ids)
          )) order by o.position), '[]'::jsonb)
          from public.survey_question_options o where o.question_id = q.id
        )
        else '[]'::jsonb
      end,
      'number_summary', case
        when q.type = 'number'::public.survey_question_type then (
          select jsonb_build_object(
            'min', min(a.value_number), 'max', max(a.value_number),
            'avg', round(avg(a.value_number), 2), 'sum', sum(a.value_number)
          )
          from public.survey_answers a where a.question_id = q.id and a.value_number is not null
        )
        else null
      end,
      'files', case
        when q.type = 'image'::public.survey_question_type then (
          select coalesce(jsonb_agg(jsonb_build_object('path', f.storage_path, 'mime_type', f.mime_type) order by f.created_at), '[]'::jsonb)
          from public.survey_answer_files f
          join public.survey_answers a on a.id = f.answer_id
          where a.question_id = q.id
        )
        else '[]'::jsonb
      end
    ) as entry
    from public.survey_questions q
    where q.form_id = p_form_id
  ) ordered;

  return jsonb_build_object(
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'status', v_form.status,
      'deadline', v_form.deadline,
      'expected_participants', v_form.expected_participants,
      'submitted_count', v_form.submitted_count,
      'retention_hours', v_form.response_retention_hours
    ),
    'participants', (select count(*) from public.survey_participants where form_id = p_form_id),
    'next_expiry', (select min(expires_at) from public.survey_responses where form_id = p_form_id),
    'questions', v_questions
  );
end;
$$;

/** Row-per-respondent table for the results screen. Owner only. */
create or replace function public.survey_response_rows(p_form_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_form public.survey_forms%rowtype;
begin
  select * into v_form from public.survey_forms where id = p_form_id;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;
  if v_form.owner_id <> v_user then raise exception 'only the owner may read results' using errcode = '42501'; end if;

  return coalesce((
    select jsonb_agg(row_entry order by submitted_at desc)
    from (
      select r.submitted_at, jsonb_build_object(
        'response_id', r.id,
        'submitted_at', r.submitted_at,
        'expires_at', r.expires_at,
        'respondent_name', (select coalesce(nullif(btrim(p.full_name), ''), '—') from public.profiles p where p.id = r.respondent_id),
        'respondent_username', (select p.username from public.profiles p where p.id = r.respondent_id),
        'answers', coalesce((
          select jsonb_object_agg(a.question_id::text, jsonb_build_object(
            'text', a.value_text,
            'number', a.value_number,
            'date', a.value_date,
            'option_ids', to_jsonb(a.selected_option_ids),
            'files', coalesce((
              select jsonb_agg(jsonb_build_object('path', f.storage_path, 'mime_type', f.mime_type))
              from public.survey_answer_files f where f.answer_id = a.id
            ), '[]'::jsonb)
          ))
          from public.survey_answers a where a.response_id = r.id
        ), '{}'::jsonb)
      ) as row_entry
      from public.survey_responses r
      where r.form_id = p_form_id
      order by r.submitted_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) rows
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------- listings --
/** The module home: surveys this person created and surveys they took part in. */
create or replace function public.my_surveys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  return jsonb_build_object(
    'created', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'title', f.title, 'status', f.status, 'deadline', f.deadline,
        'expected_participants', f.expected_participants, 'submitted_count', f.submitted_count,
        'question_count', (select count(*) from public.survey_questions q where q.form_id = f.id),
        'created_at', f.created_at, 'owner_name', 'Siz', 'is_owner', true
      ) order by f.created_at desc)
      from public.survey_forms f where f.owner_id = v_user
    ), '[]'::jsonb),
    'participating', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'title', f.title, 'status', f.status, 'deadline', f.deadline,
        'expected_participants', f.expected_participants, 'submitted_count', f.submitted_count,
        'question_count', (select count(*) from public.survey_questions q where q.form_id = f.id),
        'created_at', f.created_at,
        'owner_name', (select coalesce(nullif(btrim(p.full_name), ''), '—') from public.profiles p where p.id = f.owner_id),
        'is_owner', false,
        'my_status', sp.status,
        'my_submitted_at', sp.submitted_at
      ) order by sp.first_viewed_at desc)
      from public.survey_participants sp
      join public.survey_forms f on f.id = sp.form_id
      where sp.user_id = v_user and f.owner_id <> v_user
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------- templates --
/** Saves a question set for reuse. Passing p_template_id rewrites that template. */
create or replace function public.save_survey_template(
  p_template_id uuid,
  p_name text,
  p_description text default '',
  p_questions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_template public.survey_templates%rowtype;
  v_question jsonb;
  v_index integer := 0;
begin
  if v_owner is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(coalesce(p_questions, '[]'::jsonb)) <> 'array' then
    raise exception 'questions must be an array' using errcode = '22023';
  end if;

  if p_template_id is null then
    insert into public.survey_templates (owner_id, name, description)
    values (v_owner, btrim(p_name), left(btrim(coalesce(p_description, '')), 500))
    returning * into v_template;
  else
    select * into v_template from public.survey_templates where id = p_template_id for update;
    if not found or v_template.owner_id <> v_owner then
      raise exception 'template not found' using errcode = 'P0002';
    end if;
    update public.survey_templates
      set name = btrim(p_name), description = left(btrim(coalesce(p_description, '')), 500)
      where id = v_template.id returning * into v_template;
    delete from public.survey_template_questions where template_id = v_template.id;
  end if;

  for v_question in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    insert into public.survey_template_questions (
      template_id, position, type, label, helper_text, is_required, latin_only, config, options
    ) values (
      v_template.id, v_index, (v_question ->> 'type')::public.survey_question_type,
      btrim(v_question ->> 'label'), left(btrim(coalesce(v_question ->> 'helper_text', '')), 300),
      coalesce((v_question ->> 'is_required')::boolean, true),
      coalesce((v_question ->> 'latin_only')::boolean, false),
      coalesce(v_question -> 'config', '{}'::jsonb),
      coalesce(v_question -> 'options', '[]'::jsonb)
    );
    v_index := v_index + 1;
  end loop;

  return v_template.id;
end;
$$;

/** Copies a template into a new draft survey and counts the reuse. */
create or replace function public.create_survey_from_template(p_template_id uuid, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_template public.survey_templates%rowtype;
  v_questions jsonb;
  v_form_id uuid;
begin
  select * into v_template from public.survey_templates where id = p_template_id;
  if not found or v_template.owner_id <> v_owner then
    raise exception 'template not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', tq.type, 'label', tq.label, 'helper_text', tq.helper_text,
    'is_required', tq.is_required, 'latin_only', tq.latin_only,
    'config', tq.config, 'options', tq.options
  ) order by tq.position), '[]'::jsonb) into v_questions
  from public.survey_template_questions tq where tq.template_id = p_template_id;

  if jsonb_array_length(v_questions) = 0 then
    raise exception 'template has no questions' using errcode = '22023';
  end if;

  v_form_id := public.save_survey_form(
    null, coalesce(nullif(btrim(p_title), ''), v_template.name), v_template.description,
    null, null, '', v_questions
  );

  update public.survey_templates set use_count = use_count + 1 where id = p_template_id;
  return v_form_id;
end;
$$;

-- --------------------------------------------------------------- retention --
/**
 * Removes every response past its window and reports the storage paths that
 * went with it, so the caller can delete the objects too. Service role only:
 * this is the scheduled sweep, not something a signed-in person may trigger.
 *
 * Returns paths *before* the rows go, because after the cascade nothing knows
 * which files existed.
 */
create or replace function public.purge_expired_survey_responses(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_paths text[];
  v_forms uuid[];
  v_count integer;
begin
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(distinct form_id), '{}')
    into v_ids, v_forms
  from (
    select id, form_id from public.survey_responses
    where expires_at <= now()
    order by expires_at
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ) due;

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('purged', 0, 'paths', '[]'::jsonb);
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.survey_answer_files where response_id = any(v_ids);

  delete from public.survey_responses where id = any(v_ids);
  get diagnostics v_count = row_count;

  insert into public.survey_purge_audit (form_id, responses_purged, files_purged)
  select f, count(*)::integer, 0 from unnest(v_forms) as f group by f;

  return jsonb_build_object(
    'purged', v_count,
    'paths', to_jsonb(v_paths),
    'forms', to_jsonb(v_forms)
  );
end;
$$;

comment on function public.purge_expired_survey_responses(integer) is
  'Scheduled retention sweep. Deletes responses past expires_at and returns their storage paths for object removal.';

/** Records an export so a survey's download history is auditable. */
create or replace function public.record_survey_export(
  p_form_id uuid,
  p_format text,
  p_storage_path text,
  p_row_count integer
)
returns public.survey_exports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.survey_forms%rowtype;
  v_row public.survey_exports%rowtype;
begin
  select * into v_form from public.survey_forms where id = p_form_id;
  if not found then raise exception 'survey not found' using errcode = 'P0002'; end if;

  insert into public.survey_exports (form_id, owner_id, format, storage_path, row_count)
  values (p_form_id, v_form.owner_id, p_format, p_storage_path, greatest(coalesce(p_row_count, 0), 0))
  returning * into v_row;
  return v_row;
end;
$$;

-- --------------------------------------------------------------- realtime --
-- The results screen watches the form row: submitted_count changes as answers
-- land, without a single response row crossing the wire.
alter publication supabase_realtime add table public.survey_forms;

-- ----------------------------------------------------------------- grants --
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.is_latin_text(text)',
    'public.normalize_uz_phone(text)',
    'public.survey_is_owner(uuid, uuid)',
    'public.survey_is_participant(uuid, uuid)',
    'public.survey_can_read_response(uuid, uuid)',
    'public.module_access_state(text)',
    'public.assert_module_access(text, text)',
    'public.save_survey_form(uuid, text, text, timestamptz, integer, text, jsonb)',
    'public.set_survey_status(uuid, public.survey_status)',
    'public.open_survey(uuid)',
    'public.submit_survey_response(uuid, jsonb, text)',
    'public.survey_results_summary(uuid)',
    'public.survey_response_rows(uuid, integer)',
    'public.my_surveys()',
    'public.save_survey_template(uuid, text, text, jsonb)',
    'public.create_survey_from_template(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;

-- The sweep and the export recorder are server-side only.
revoke all on function public.purge_expired_survey_responses(integer) from public;
revoke all on function public.purge_expired_survey_responses(integer) from anon;
revoke all on function public.purge_expired_survey_responses(integer) from authenticated;
grant execute on function public.purge_expired_survey_responses(integer) to service_role;

revoke all on function public.record_survey_export(uuid, text, text, integer) from public;
revoke all on function public.record_survey_export(uuid, text, text, integer) from anon;
revoke all on function public.record_survey_export(uuid, text, text, integer) from authenticated;
grant execute on function public.record_survey_export(uuid, text, text, integer) to service_role;

-- Exports land in the existing private bucket, which until now only held decks.
update storage.buckets
  set allowed_mime_types = array[
    'application/pdf', 'image/png',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
  where id = 'exports';
