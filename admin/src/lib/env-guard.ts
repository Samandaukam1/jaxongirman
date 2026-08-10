/**
 * Refusing a bad Supabase key where the mistake is still legible.
 *
 * The client puts whatever key it is given into `Authorization: Bearer …`, and
 * PostgREST answers a non-JWT with `Expected 3 parts in JWT; got 1` — a message
 * about the shape of a string, from a service that never learns which
 * environment variable produced it. Checking the shape here turns that into a
 * sentence naming the variable.
 *
 * A copy of `web/lib/env-guard.ts` and `user/src/lib/env-guard.ts`. The three
 * apps read their environment through three different bundlers, so each keeps
 * its own bootstrap; this is the part of it that has nothing to do with which
 * bundler is reading.
 *
 * No message ever contains the key. A key that is wrong is still a credential.
 */

const SETUP_HINT = "Copy admin/.env.example to admin/.env and set it, then rebuild — VITE_* values are inlined at build time.";

/** A JWT is three dot-separated parts; `sb_publishable_…` is the newer form. */
function looksPublishable(key: string): boolean {
  return key.split(".").length === 3 || key.startsWith("sb_publishable_");
}

/** Server-only credentials, which must never reach an app bundle. */
function looksSecret(key: string): boolean {
  return key.startsWith("sb_secret_") || key.includes("service_role");
}

export function publishableKey(key: string | undefined, variable: string): string {
  if (!key) {
    throw new Error(`${variable} is not set, so the Supabase client cannot be created. ${SETUP_HINT}`);
  }
  if (looksSecret(key)) {
    throw new Error(
      `${variable} holds a service-role or secret key. That key must never ship inside a browser bundle — rotate it in the Supabase dashboard and set the publishable (anon) key here instead.`,
    );
  }
  if (!looksPublishable(key)) {
    throw new Error(
      `${variable} is not a Supabase publishable key. Expected a JWT or a key beginning with "sb_publishable_". ${SETUP_HINT}`,
    );
  }
  return key;
}

export function requiredUrl(url: string | undefined, variable: string): string {
  if (!url) {
    throw new Error(`${variable} is not set, so the Supabase client cannot be created. ${SETUP_HINT}`);
  }
  return url;
}
