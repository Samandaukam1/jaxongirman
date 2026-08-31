-- The phone has to know which engine is running, because it draws a chooser.
--
-- `create.tsx` offers a design catalogue and a "Jaxongir AI tanlaydi" switch.
-- Under the generative engine neither means anything: no design is resolved,
-- none is pinned, and the slug the screen sends is ignored. Worse, a tier with
-- no published designs tells the author to pick a different tier — advice that
-- was true when a deck needed a design and is now simply wrong.
--
-- The screen cannot know any of that: `app_settings` is readable only where
-- `public_read` says so, and this row did not. It is not a secret — the admin
-- panel shows it, and the answer is visible in every deck the product makes.
update public.app_settings
   set public_read = true
 where key = 'design.generative_enabled';
