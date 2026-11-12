# Jaxongirman workspace — rules for every agent and every computer

This repository is worked on from **more than one computer**. Work done on one
machine reaches the others only through GitHub (`Samandaukam1/jaxongirman`,
branch `main`). Losing that work has happened, so these rules are not optional.

## Before you start, and again before you push

- `git fetch origin && git pull --rebase origin main`. Never start from a stale checkout.
- Never `git push --force` to `main`. If a push is rejected, pull and resolve.
- Resolve conflicts by keeping **both** sides; never drop the other computer's work.

## Deploying

- The website (`web/`, jaxongirman.app) deploys from GitHub: a push to `main`
  is the deploy. Do **not** run `vercel deploy` from a local checkout — it
  publishes whatever that checkout has, including what it is missing.
- Database changes ship as files in `supabase/migrations/` and are pushed to
  GitHub in the same change. A migration applied to production must exist here.

## Never remove

The legal pages the app stores link to, and the company named on them:

- `web/app/{privacy,terms,support,delete-account,refund}/page.tsx`
- `web/app/_legal/`, `web/lib/site-pages.ts`, `web/lib/legal-text.ts`
- `web/lib/company.ts` — “MUKAMMAL MEDIA GROUP” MChJ, Jaxongirman's operator
- `web/public/legal/` — its registration certificate (guvohnoma) and publishing
  notice confirmation (tasdiqnoma)
- the "MUKAMMAL MEDIA GROUP MChJ — Tasarrufidagi loyiha" line in `web/app/layout.tsx`
- `supabase/migrations/202610200002_site_pages.sql` (production ran it; if it
  conflicts on a pull, either side is fine — both match production)

`web/scripts/check-legal-pages.mjs` runs before every site build and fails the
build if any of these is missing, so production keeps its last good deployment.
Fix the checkout; do not weaken the check.
