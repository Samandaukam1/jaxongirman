-- The newest version of the app in the stores.
--
-- A phone on an older version is shown a full-screen notice whose one big
-- button, "Yangilash", opens `url` (jaxongirman.app/ilova, which sends each
-- phone to its own store). `required: true` hides "Keyinroq". To ask everyone
-- to update, raise `version` here once the new build is live in both stores.
--
-- Readable signed out: the notice is shown before sign-in too.

insert into public.app_settings (key, value, description, public_read)
values (
  'app.latest_version',
  '{"version": "2.0.0", "url": "https://jaxongirman.app/ilova", "required": false}'::jsonb,
  'Newest app version in the stores. Phones on an older version see the update notice (Yangilash → url); required=true hides "Keyinroq".',
  true
)
on conflict (key) do nothing;
