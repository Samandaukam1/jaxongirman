# Ma'lumotlarni yig'ish (data collection)

The survey module: a person builds a questionnaire, shares a deep link, and gets
the answers back as a spreadsheet. It is the second product in the workspace
after the presentation generator, and it shares that product's account, wallet,
notification and role systems rather than duplicating them.

Two rules shape everything below.

**An abandoned form leaves nothing behind.** There is no draft table and no
per-answer write path. A response exists only because `submit_survey_response()`
wrote the response, every answer and every file reference in one transaction.
Half-filled forms live in the device's memory and nowhere else — including the
images, which are uploaded at the moment of submit rather than when they are
picked. If the submit is refused (a Cyrillic answer to a Latin-only question,
say) the transaction rolls back and the server is left as it was.

**Answers are temporary; questions are not.** Every response carries an
`expires_at` written when it was submitted, and a scheduled sweep removes the
rows and the private image objects behind them. The creator's question sets live
on as reusable templates. This is a stated retention window, not a claim that
nothing is ever stored — the app says so on the response screen and on the
results dashboard.

## Tables

| Table | Holds | Lifetime |
|---|---|---|
| `survey_forms` | Title, deadline, status, denormalized `submitted_count` | Until deleted |
| `survey_questions`, `survey_question_options` | The question set | Until deleted |
| `survey_participants` | Who opened the link, and whether they submitted | Until deleted |
| `survey_responses` | One row per respondent, with `expires_at` | Retention window |
| `survey_answers`, `survey_answer_files` | The answers themselves | Cascades with the response |
| `survey_templates`, `survey_template_questions` | Reusable question sets | Until deleted |
| `survey_exports` | Download history | Until deleted |
| `survey_purge_audit` | Counts of what the sweep removed — never content | Until deleted |

`module_entitlements` holds paid access as a dated window (`starts_at`,
`expires_at`, `status`, `purchased_amount`, `currency`), and `coin_packages` is
the admin-owned J Coin catalogue.

## Who can read what

RLS is the whole of it; no screen is trusted to filter.

| Data | Creator | Respondent | Other user | Admin |
|---|---|---|---|---|
| Form and questions | Yes | After opening the link | No | Yes (moderation) |
| Response rows | Yes, own survey | Own only | No | **No** |
| Answers and files | Yes, own survey | Own only | No | **No** |
| Templates | Own only | — | No | No |

Admins deliberately have no path to an answer. `survey_responses` and
`survey_answers` carry no admin clause in their policies, and the console's RPCs
(`admin_list_surveys`, `admin_module_overview`) return counts and ownership only.
Moderation means closing an abusive survey — `admin_set_survey_status`, audited,
with a notification to the owner — not reading what people wrote in it.

Uploaded images live in the private `survey-uploads` bucket under
`<respondent_id>/<form_id>/<file>`. The first segment decides who may write, the
second which owner may read. Nothing is ever public; the results screen and the
export both use short-lived signed URLs.

## Server functions

| Function | Purpose |
|---|---|
| `save_survey_form` | Creates or rewrites a survey and its whole question set atomically. Refuses to rewrite questions once a response points at them. |
| `set_survey_status` | Open, close, or return to draft. Opening needs questions and a future deadline. |
| `open_survey` | The deep-link entry point. Registers the participant (which is what grants RLS visibility) and returns the form, questions and whether they already submitted. |
| `submit_survey_response` | The only write path for a response. Validates required, alphabet, phone shape, numeric bounds, option membership, file size and file ownership. |
| `survey_results_summary`, `survey_response_rows` | The owner's dashboard. Owner-only, checked server-side. |
| `my_surveys` | The module home: created and participating. |
| `save_survey_template`, `create_survey_from_template` | Reusable question sets. |
| `purge_expired_survey_responses` | The retention sweep. Service role only. |
| `module_access_state`, `assert_module_access` | Access described, and access enforced. |

## Access and pricing

`app_settings.modules.data_collection` holds the price, the window and two
enforcement switches:

```json
{
  "price_amount": 11000, "currency": "UZS", "duration_months": 11,
  "enforce_creator_access": false, "enforce_respondent_access": false,
  "response_retention_hours": 48, "max_questions": 40, "max_image_bytes": 3145728
}
```

Both switches are **off**, and that is a deliberate, visible state rather than an
oversight. No payment provider is wired up (`app_settings.payments.config` has
`configured: false`), so enforcing paid access would close the module to
everyone with no way to open it. The apps read this state and describe it
honestly: the access screen says whether access is required, whether the caller
holds it, and that purchases are not yet possible. Turn the switches on in
**Admin → Modullar va J Coin** the day a provider goes live.

Until then, access is granted by an admin through
`admin_grant_module_access_by_email`, which writes a real entitlement row — not a
flag, not a simulated purchase.

## Retention sweep

`purge-survey-responses` deletes every response past `expires_at`, removes the
image objects that went with it, and records counts in `survey_purge_audit`. It
authenticates against the service-role key or `SURVEY_PURGE_SECRET`; a signed-in
user cannot call it.

Schedule it hourly on the hosted project. Store the credential in Vault rather
than writing it into a migration:

```sql
-- once, as a privileged operator
select vault.create_secret('<service-role-or-purge-secret>', 'survey_purge_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('survey-retention-sweep', '7 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/purge-survey-responses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'survey_purge_secret')
    ),
    body := '{}'::jsonb
  );
$$);
```

The sweep is idempotent and batched — a missed hour is caught up by the next run.

## Export

`export-survey` builds an XLSX (primary) or CSV from the owner's results and
uploads it to the private `exports` bucket under the owner's own folder, then
returns a one-hour signed URL. Ownership is checked on the server against the
form row, so a client that asks for someone else's survey gets 403.

Image answers appear as a filename plus a signed URL whose lifetime matches the
form's retention window — an exported sheet cannot outlive the data inside it.
The XLSX writer is `supabase/functions/_shared/xlsx.ts`: about a hundred lines of
ZIP and OOXML over Deno's own `CompressionStream`, so a function that handles
survey answers carries no third-party dependency to do it.

## Verification

```bash
npx supabase db reset --local
npx supabase test db                 # includes rls_data_collection.test.sql
npx supabase functions serve --env-file supabase/functions/.env.test
npm run test:survey                  # end-to-end: author → answer → export → sweep
```
