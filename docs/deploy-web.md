# Deploying the public site

`jaxongirman.uz` does not resolve yet, so nothing is live. This is the whole of
what it takes to change that.

The site is a workspace inside this monorepo, so Vercel deploys it by pointing at
a subdirectory rather than by needing its own repository.

## Import

1. **vercel.com/new** → import `Samandaukam1/jaxongirman`.
2. **Root Directory: `web`.** This is the only setting that has to be typed;
   `web/vercel.json` supplies the framework, the build command and the header
   rules. Leaving the root at the repository would build the admin console.
3. Environment variables, for Production **and** Preview:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xkdlaavvyianxerxxjpo.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable (anon) key |
   | `NEXT_PUBLIC_APP_URL` | the deployment origin, e.g. `https://jaxongirman.uz` |

   A build without the first two fails deliberately rather than shipping a page
   that rejects every request — see [web/lib/env-guard.ts](../web/lib/env-guard.ts).

   `NEXT_PUBLIC_APP_URL` is what the O‘yingoh join QR points at. Without it the
   QR falls back to the browser's own origin, which is correct on a projector but
   wrong the moment a custom domain fronts a `*.vercel.app` deployment. Set it.

## Domain

Point `jaxongirman.uz` at the project, then set `NEXT_PUBLIC_APP_URL` to that
origin and redeploy — the variable is inlined at build time, so changing it
without a rebuild changes nothing.

Moving to `jaxongirman.app` later is the same three edits every time: this
variable, the two association files under
[web/public/.well-known/](../web/public/.well-known/), and the matching entries in
`user/app.json` plus `user/ios/Jaxongirman/Jaxongirman.entitlements`. No code
moves; see [web/lib/public-url.ts](../web/lib/public-url.ts).

## Supabase

Add the deployment origin to **Authentication → URL Configuration → Redirect
URLs**, or sign-in redirects are rejected.

## Universal links

Two placeholders in
[web/public/.well-known/](../web/public/.well-known/README.md) must be filled
before a scanned join QR opens the app instead of this site: the Apple Team ID
and the Android release SHA-256. Neither is derivable from this repository — the
Xcode project is unsigned and the keystore lives in EAS.

Until they are filled the flow still works end to end: the landing page prints
the six-digit join code, and entering it in the app is a first-class path rather
than a fallback. Verify afterwards with:

```bash
curl -sI https://<domain>/.well-known/apple-app-site-association | grep -i content-type
```

It must say `application/json` with no redirect. Apple caches the association
through its own CDN, so allow time after a change.

## What is already deployed

The database and the Edge Functions are live on the linked project
(`xkdlaavvyianxerxxjpo`): all O‘yingoh migrations are applied and
`generate-game` is active. The admin console deploys from its own extracted
repository, `Samandaukam1/jaxongirman-admin`. Only this site and the mobile
builds remain.
