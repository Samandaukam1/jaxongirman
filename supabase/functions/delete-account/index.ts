/**
 * "O‘CHIRISH" — the server side of it.
 *
 * A client may not delete a user. Doing so needs the service-role key, and a
 * key that can delete any account is not a key that belongs in an app store
 * binary — so the app can only ask, and this is what it asks. The only identity
 * this function will act on is the one carried by the caller's own access
 * token: there is no `userId` parameter to get wrong or to guess at.
 *
 * The order matters and is the whole design:
 *
 *   1. `purge_account_data` empties the account inside one transaction and
 *      hands back the list of storage objects that belonged to it. Nothing is
 *      deleted from storage until the database has agreed the rows are gone.
 *   2. The objects are removed, bucket by bucket. A failure here is reported
 *      and does not roll anything back — the rows are already gone, and the
 *      alternative to an orphaned file is an orphaned row, which is worse.
 *   3. The `auth.users` row goes, unless the books need the id to stay. See
 *      the migration for why that case exists; what matters here is that in
 *      both branches the person can no longer sign in and nothing identifying
 *      is left behind.
 *
 * Idempotent throughout. Running it twice on a half-finished deletion finishes
 * it rather than failing: the purge deletes nothing the second time, the object
 * list comes back empty, and deleting an already-deleted user is not an error
 * worth surfacing.
 */
import { createClient } from "npm:@supabase/supabase-js";
import { privacySafeIdentifier } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";

/**
 * The word the app has to say.
 *
 * Not a formality: this function is one POST away from a permanent action, and
 * a body-less request that reached it by accident — a retry, a misrouted call,
 * a copied fetch — must not be the thing that empties somebody's account. The
 * confirmation modal is the guard a person sees; this is the one they do not.
 */
const CONFIRMATION = "DELETE";

/** Storage removes in batches; a person with a lot of decks has a lot of files. */
const REMOVE_BATCH = 100;

type PurgeResult = {
  retained?: boolean;
  reasons?: string[];
  objects?: { bucket: string; name: string }[];
  blocked?: string[];
  archivedProducts?: string[];
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase server environment is incomplete");

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Authentication required", "unauthorized");
    const accessToken = authorization.slice("Bearer ".length).trim();

    let body: { confirm?: unknown };
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Request body must be valid JSON", "invalid_json");
    }
    if (body?.confirm !== CONFIRMATION) {
      throw new HttpError(400, "Deletion must be confirmed", "confirmation_required");
    }

    /**
     * Who is asking, established from the token rather than from the body.
     *
     * `requestContext` is not used here on purpose. It refuses a blocked
     * profile, and the purge blocks the profile as its last act — so a
     * deletion interrupted between the purge and the auth delete could never
     * be finished, which is the one case retrying has to work in.
     */
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: caller, error: callerError } = await userClient.auth.getUser();
    if (callerError || !caller.user) throw new HttpError(401, "Invalid or expired session", "unauthorized");
    const userId = caller.user.id;

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await service.rpc("purge_account_data", { p_user: userId });
    if (error) throw error;
    const purge = (data ?? {}) as PurgeResult;

    // ------------------------------------------------------------- storage --
    const byBucket = new Map<string, string[]>();
    for (const object of purge.objects ?? []) {
      const paths = byBucket.get(object.bucket) ?? [];
      paths.push(object.name);
      byBucket.set(object.bucket, paths);
    }

    let filesRemoved = 0;
    const storageFailures: string[] = [];
    for (const [bucket, paths] of byBucket) {
      for (let at = 0; at < paths.length; at += REMOVE_BATCH) {
        const batch = paths.slice(at, at + REMOVE_BATCH);
        const { error: removeError } = await service.storage.from(bucket).remove(batch);
        if (removeError) {
          console.error(`delete-account: ${bucket} cleanup failed`, removeError.message);
          storageFailures.push(bucket);
        } else {
          filesRemoved += batch.length;
        }
      }
    }

    // ---------------------------------------------------------------- auth --
    /**
     * The session goes before the account does.
     *
     * A token minted a minute ago stays valid for its whole life whatever
     * happens to the row behind it, so a global sign-out is what actually ends
     * the person's access on every device they are signed in on. It is best
     * effort: if it fails, the delete below still lands, and a token that
     * outlives its user authenticates nothing.
     */
    try {
      await service.auth.admin.signOut(accessToken, "global");
    } catch (signOutError) {
      console.error("delete-account: session revoke failed", signOutError);
    }

    const retained = Boolean(purge.retained) || (purge.blocked ?? []).length > 0;
    let outcome: "deleted" | "anonymised" = "deleted";

    if (retained) {
      outcome = await anonymise(service, userId);
    } else {
      const { error: deleteError } = await service.auth.admin.deleteUser(userId);
      if (deleteError && !isAlreadyGone(deleteError)) {
        /**
         * A `restrict` key the retention check did not know about.
         *
         * Rather than answer 500 to somebody who has just had their profile
         * emptied, fall through to the same anonymised end state the retained
         * branch produces. The account is unusable either way; the difference
         * is only whether an id survives in a ledger.
         */
        console.error("delete-account: hard delete refused, anonymising instead", deleteError.message);
        outcome = await anonymise(service, userId);
      }
    }

    return json({
      outcome,
      reasons: purge.reasons ?? [],
      archivedProducts: (purge.archivedProducts ?? []).length,
      filesRemoved,
      storageFailures,
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

/**
 * Everything readable about the person, taken off the auth row.
 *
 * The row itself has to stay — something in the books points at its id — but
 * an id is not an identity. The email becomes a hash on a `.invalid` domain,
 * which is a TLD reserved by the RFCs precisely so that it can never be routed
 * anywhere, and the hash is one-way: it keeps two deleted accounts from
 * colliding on the unique index without being reversible into an address.
 * Phone and both metadata bags go entirely, and the soft delete is what makes
 * the row unusable for signing in — including through an OAuth identity, which
 * an email change on its own would not have touched.
 */
async function anonymise(
  service: ReturnType<typeof createClient>,
  userId: string,
): Promise<"anonymised"> {
  const token = await privacySafeIdentifier(userId);
  const { error: scrubError } = await service.auth.admin.updateUserById(userId, {
    email: `deleted-${token}@deleted.invalid`,
    phone: null,
    user_metadata: {},
    app_metadata: {},
  });
  if (scrubError && !isAlreadyGone(scrubError)) throw scrubError;

  const { error: softError } = await service.auth.admin.deleteUser(userId, true);
  if (softError && !isAlreadyGone(softError)) throw softError;
  return "anonymised";
}

/** A second run finding nothing to do is a success, not a failure. */
function isAlreadyGone(error: { status?: number; message?: string }): boolean {
  if (error.status === 404) return true;
  return /not found/i.test(error.message ?? "");
}
