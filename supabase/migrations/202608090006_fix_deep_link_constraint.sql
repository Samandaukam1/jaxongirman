-- Repairs the notifications.deep_link check, which could never be evaluated.
--
-- The constraint was written as `deep_link ~ '^/[...]{0,300}$'`. Postgres's
-- regex engine caps a bound at 255, so anything above it raises
-- "invalid regular expression: invalid repetition count(s)" — at evaluation
-- time, not at definition time. The constraint therefore looked fine until the
-- first row that actually carried a deep_link, and then every insert that
-- carried one failed: the survey_completed notification, and every admin
-- moderation message.
--
-- The length rule moves to char_length(), where 300 is just a number, and the
-- shape rule keeps its job: a relative in-app path, never an absolute URL, and
-- never a protocol-relative "//host" that a screen might follow off-app.

alter table public.notifications
  drop constraint if exists notifications_deep_link_shape;

alter table public.notifications
  add constraint notifications_deep_link_shape
  check (
    deep_link is null
    or (
      char_length(deep_link) <= 300
      -- '-' sits last so it is a literal, not a range.
      and deep_link ~ '^/[A-Za-z0-9()_/?&=.\[\]-]+$'
      and deep_link !~ '//'
    )
  );
