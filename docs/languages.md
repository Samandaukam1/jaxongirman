# Languages

The app speaks Uzbek (Latin), English and Russian. Uzbek is the default and the
source of every table.

## Interface words

- Static tables in `user/src/i18n/ns/*.ts`, one file per area, each written as
  `translations(uz, en, ru)`. The `Shape<T>` type refuses a key one language has
  and another lacks; `user/tests/i18n-tables.test.mjs` also checks that every
  string has the same `{{placeholders}}` and `<tags>` in all three.
- No model and no network call translates a screen. Changing the language
  (Profil → Til, or the switch on the sign-in screen) re-renders every screen at
  once; it is kept in AsyncStorage (`jx.language`) and on the account
  (`profiles.preferred_language`).
- Plural keys are written `_one/_few/_many/_other`. Hermes may lack
  `Intl.PluralRules`, in which case i18next uses only `one`/`other`, so Russian
  strings are worded to read correctly with any number ("Источников: 3").
- Dates, clocks and numbers follow the language and the device: the device's
  time zone and 12/24-hour clock, English groups thousands with a comma. Money is
  always so‘m (UZS / сум) — foreign currencies wait for a provider that takes them.
- Server refusals are put in the reader's language by `user/src/lib/errors.ts`
  (by error code or by the server's known sentence). An unknown refusal is shown
  as the server wrote it.

## Deck language

- Chosen on the create screen, separate from the interface language; stored in
  `presentations.language`.
- The generator writes the slides, the agenda/thanks/references chrome, chart
  numbers and the defence script in it, with one instruction in the existing
  prompts (`supabase/functions/_shared/glass/language.ts`) — no extra model call.
  Russian decks use only Cyrillic-capable font families.
- Uzbek decks are Latin only: a topic or title with Cyrillic letters is refused
  by the app (with a one-tap local transliteration, `user/src/lib/script.ts`) and
  by `start_generation` (`22023`, detail `cyrillic_topic`).
- Every `ai_usage` row of a deck carries `metadata.language`; the console shows
  tokens and cost per language.

## Operator content and switches (`/tillar` in the console)

- Plan, coin package and material type words carry `*_i18n` objects
  (`{uz, en, ru}`); the iOS payment notice keeps `copy_i18n`, the refund policy
  `i18n`. The app shows the reader's language and falls back to Uzbek.
- `admin_set_translation` writes English/Russian for one field and audits the
  value before and after; `admin_set_language_settings` (super admin) switches
  English or Russian off for the interface or for decks (`app_settings`
  `i18n.languages`). Uzbek cannot be switched off. A deck language switched off
  is refused by `start_generation` (detail `language_disabled`).
- The refund agreement is recorded in the language the buyer read
  (`marketplace_refund_ack` → `accepted_text`, `language`).

## Free decks

A deck made with welcome pages is at most 10 pages: the create screen switches
off the longer presets with a note, and `start_generation` refuses more
(`22023`, detail `free_deck_max_pages`).
