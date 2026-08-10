/**
 * The 48-hour retention sweep.
 *
 * Survey answers are temporary by design: every response carries an `expires_at`
 * written when it was submitted, and this function is what makes that window
 * real. It deletes the rows and the private image objects that went with them,
 * then records counts — never content — in survey_purge_audit.
 *
 * Nobody signed in may call it. The caller must present the service-role key, or
 * a dedicated SURVEY_PURGE_SECRET, so the sweep can only be driven by the
 * scheduler that owns it.
 */
import { createClient } from "@supabase/supabase-js";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";

/** Constant-time compare, so a wrong secret cannot be found one byte at a time. */
function secretsMatch(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase server environment is incomplete");

    const presented = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
      || (request.headers.get("x-purge-secret") ?? "").trim();
    const cronSecret = Deno.env.get("SURVEY_PURGE_SECRET") ?? "";
    const authorized = (presented && secretsMatch(presented, serviceKey))
      || (cronSecret && presented && secretsMatch(presented, cronSecret));
    if (!authorized) throw new HttpError(401, "Scheduler credential required", "unauthorized");

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let purged = 0;
    let filesRemoved = 0;
    const forms = new Set<string>();

    // Batched, because a backlog after downtime should not be one enormous
    // delete. Ten rounds of 500 is far more than a day of traffic; whatever is
    // left waits for the next run rather than holding this one open.
    for (let round = 0; round < 10; round += 1) {
      const { data, error } = await service.rpc("purge_expired_survey_responses", { p_limit: 500 });
      if (error) throw error;
      const result = data as { purged?: number; paths?: string[]; forms?: string[] } | null;
      const count = result?.purged ?? 0;
      if (count === 0) break;

      purged += count;
      for (const form of result?.forms ?? []) forms.add(form);

      const paths = result?.paths ?? [];
      if (paths.length > 0) {
        // The rows are already gone; a failure here would leave orphaned objects,
        // so it is reported rather than swallowed, but it must not roll back a
        // deletion that already happened.
        const { error: storageError } = await service.storage.from("survey-uploads").remove(paths);
        if (storageError) console.error("survey-uploads cleanup failed", storageError.message);
        else filesRemoved += paths.length;
      }

      if (count < 500) break;
    }

    return json({ purged, filesRemoved, forms: forms.size, sweptAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
});
