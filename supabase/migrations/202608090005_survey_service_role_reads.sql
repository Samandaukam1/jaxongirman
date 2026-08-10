-- Lets the server read the module's tables.
--
-- This schema hands out table privileges explicitly rather than relying on
-- default privileges, and 202608090003 granted the survey tables to
-- `authenticated` only. `service_role` was left with nothing, so
-- export-survey — which reads the form, its questions and its responses with
-- the service client before building a spreadsheet — failed with
-- "permission denied for table survey_responses" on its first call.
--
-- Read-only, deliberately. Every server-side *write* in this module already
-- goes through a security-definer function (submit_survey_response,
-- purge_expired_survey_responses, record_survey_export), and none of them needs
-- a table privilege to do its work. Granting only SELECT keeps it that way: a
-- future function that wants to write has to be written as one, rather than
-- reaching into a table because the grant happened to be there.

grant select on
  public.survey_forms,
  public.survey_questions,
  public.survey_question_options,
  public.survey_participants,
  public.survey_responses,
  public.survey_answers,
  public.survey_answer_files,
  public.survey_templates,
  public.survey_template_questions,
  public.survey_exports,
  public.survey_purge_audit,
  public.module_entitlements,
  public.coin_packages
to service_role;
