/**
 * What a Google OAuth client ID looks like, for the scripts.
 *
 * The identifier after the hyphen is required to be long because the short
 * fakes are the ones that actually get pasted: `xxxx`, `yyyy`, `zzzz` out of an
 * example are well-formed by every other measure and sail through a check that
 * only looks at the shape of the ends. Google's own identifiers are around
 * thirty characters, so twelve is a floor no real ID comes near and no
 * placeholder reaches.
 *
 * This is a heuristic and cannot be anything else — only Google can say whether
 * an ID exists. It exists to catch a paste that was never meant to be kept, not
 * to authenticate anything.
 *
 * `src/lib/auth/social-auth-core.ts` holds the same rule for the app itself. It
 * cannot import this one: that file is compiled standalone by the test harness
 * and must stay free of every dependency. `tests/social-auth.test.mjs` compares
 * the two patterns and fails if they drift apart.
 */
export const CLIENT_ID = /^\d{6,}-[a-z0-9]{12,}\.apps\.googleusercontent\.com$/;

export const CLIENT_ID_EXAMPLE = "847263910284-k3m9d2ba7qp1vn8slx4rj6cwe5tzhu0y.apps.googleusercontent.com";

export function isClientId(value) {
  return CLIENT_ID.test((value ?? "").trim());
}
