/**
 * Where a person studies, and what they study.
 *
 * The profile screen shows a name, an email and a bio, and the products around
 * it keep asking for two things it does not hold: the institution and the field
 * of study. An obyektivka needs both by name, a defence script reads better
 * knowing who is presenting to whom, and a person filling the same two boxes
 * into every document they generate has been asked twice for something the app
 * already knew.
 *
 * Free text rather than a list of institutions. A closed list is a maintenance
 * job — every new campus is a migration — and it would be wrong on the first
 * day for anybody outside it.
 */

alter table public.profiles
  add column if not exists organization text,
  add column if not exists field_of_study text;

comment on column public.profiles.organization is
  'The university, school or workplace a person names for themselves. Free text.';
comment on column public.profiles.field_of_study is
  'The direction or speciality they study or work in. Free text.';

/**
 * Length is checked here rather than trusted from a phone.
 *
 * The existing `profiles_update_own` policy already decides *who* may write
 * these; nothing yet decided *what*, and a text column with no ceiling is a
 * place to put a megabyte.
 */
alter table public.profiles
  drop constraint if exists profiles_organization_length,
  add constraint profiles_organization_length
    check (organization is null or char_length(organization) <= 160);

alter table public.profiles
  drop constraint if exists profiles_field_of_study_length,
  add constraint profiles_field_of_study_length
    check (field_of_study is null or char_length(field_of_study) <= 160);
