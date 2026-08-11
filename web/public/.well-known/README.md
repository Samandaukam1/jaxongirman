# Universal Link / App Link association

These two files are what make a scanned `https://<domain>/join/<token>` QR open
the Jaxongirman app instead of a browser. Both must be served from the deployed
domain over HTTPS with no redirect:

- `https://<domain>/.well-known/apple-app-site-association` — must be served as
  `application/json`. Next.js serves files from `public/` with a content type
  guessed from the extension, and this file deliberately has none, so confirm the
  header after deploying (`curl -I`). If the host sends
  `application/octet-stream`, add a rewrite header for that exact path.
- `https://<domain>/.well-known/assetlinks.json`

## Two placeholders must be filled before links work

1. **`TEAMID`** in `apple-app-site-association` — the Apple Developer Team ID
   that signs the app. Find it in the Apple Developer portal (Membership) or in
   `eas.json` credentials. The value becomes `ABCDE12345.uz.jaxongirman.app`.
2. **`REPLACE_WITH_RELEASE_SHA256_FINGERPRINT`** in `assetlinks.json` — the
   SHA-256 fingerprint of the signing certificate for the **release** build. With
   EAS: `eas credentials` → Android → the keystore's SHA-256. A debug build has a
   different fingerprint; add it as a second array entry if links should work in
   development too.

The app side of the association lives in `user/app.json`:
`ios.associatedDomains` and the `android.intentFilters` entry for the same host.
Both sides must name the same domain, or the OS silently falls back to opening a
browser — which is why the landing page prints the join code rather than assuming
the link worked.

Changing the public domain means changing three things: these files, the two
`app.json` entries, and `NEXT_PUBLIC_APP_URL` (see `web/lib/public-url.ts`).
Apple caches the association through its CDN, so allow time after a change.
