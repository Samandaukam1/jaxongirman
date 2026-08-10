/**
 * Refusing a bad Supabase key where the mistake is still legible.
 *
 * The client puts whatever key it is given into `Authorization: Bearer …`, and
 * PostgREST answers a non-JWT with `Expected 3 parts in JWT; got 1` — a message
 * about the shape of a string, from a service that never learns which
 * environment variable produced it. Checking the shape here turns that into a
 * sentence naming the variable.
 *
 * No message ever contains the key. A key that is wrong is still a credential,
 * and the operator reading the error already knows where to look for it.
 */

const SETUP_HINT = "Set it in your hosting provider's environment settings (or web/.env.local locally), then rebuild — Next.js inlines NEXT_PUBLIC_* at build time, so a value added afterwards will not appear in an existing build.";

/** A JWT is three dot-separated parts; `sb_publishable_…` is the newer form. */
function looksPublishable(key: string): boolean {
  return key.split(".").length === 3 || key.startsWith("sb_publishable_");
}

/** Server-only credentials, which must never reach a browser bundle. */
function looksSecret(key: string): boolean {
  return key.startsWith("sb_secret_") || key.includes("service_role");
}

export function publishableKey(key: string | undefined, variable: string): string {
  if (!key) {
    throw new Error(`${variable} is not set, so the Supabase client cannot be created. ${SETUP_HINT}`);
  }
  if (looksSecret(key)) {
    // Worth its own branch: this one is not a typo but a leak, and the fix is
    // to rotate the key rather than to correct the variable.
    throw new Error(
      `${variable} holds a service-role or secret key. That key must never be shipped to a browser — rotate it in the Supabase dashboard and set the publishable (anon) key here instead.`,
    );
  }
  if (!looksPublishable(key)) {
    throw new Error(
      `${variable} is not a Supabase publishable key. Expected a JWT or a key beginning with "sb_publishable_"; the value present is neither, which is what makes PostgREST answer "Expected 3 parts in JWT". ${SETUP_HINT}`,
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
