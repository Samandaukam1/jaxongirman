/**
 * Deleting something a person made.
 *
 * One endpoint for every kind of work the app keeps — a presentation, a 3×4
 * sheet, an obyektivka, an academic work, a game, a survey — because the rules
 * are the same for all of them and the phone should not have to know which
 * tables and buckets each one spreads across:
 *
 *   * only the owner may delete, and ownership is read here with the caller's
 *     id, never taken from the request;
 *   * a thing still being made is not deleted from under its generator — the
 *     job would carry on writing into rows that are gone, holding credits;
 *   * a game on sale in the shop stays until it is taken off sale, because
 *     buyers hold licences to it;
 *   * the row goes, its children go with it by cascade, and then its files
 *     are removed from storage, best effort — a file left behind costs space,
 *     never a deletion the person asked for.
 *
 * The service role does the deleting so that every kind works the same way:
 * some of these tables were given a delete policy and some were not, and the
 * owner check above is the policy for all of them.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Kind = "presentation" | "portrait" | "objective" | "academic" | "game" | "survey";
type Body = { kind?: string; id?: string };

const TABLE: Record<Kind, string> = {
  presentation: "presentations",
  portrait: "portrait_sheets",
  objective: "objective_documents",
  academic: "academic_works",
  game: "games",
  survey: "survey_forms",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSY_DECK = new Set(["queued", "generating"]);
const BUSY_WORK = new Set(["planning", "writing", "generating"]);

/** Every file under a folder, a few levels down — a deck's pictures sit one folder deep. */
async function filesUnder(service: SupabaseClient, bucket: string, folder: string, depth = 3): Promise<string[]> {
  const { data, error } = await service.storage.from(bucket).list(folder, { limit: 1000 });
  if (error || !data) return [];
  const found: string[] = [];
  for (const entry of data) {
    const path = `${folder}/${entry.name}`;
    if (entry.id) found.push(path);
    else if (depth > 0) found.push(...await filesUnder(service, bucket, path, depth - 1));
  }
  return found;
}

async function removeFiles(service: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  for (let at = 0; at < unique.length; at += 500) {
    const { error } = await service.storage.from(bucket).remove(unique.slice(at, at + 500));
    if (error) console.error(JSON.stringify({ event: "delete_work_files_left", bucket, reason: error.message }));
  }
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 2_000);
    const kind = body.kind as Kind;
    const id = (body.id ?? "").trim();
    if (!(kind in TABLE)) throw new HttpError(400, "Noma’lum ish turi.", "invalid_kind");
    if (!UUID.test(id)) throw new HttpError(400, "Ish tanlanmadi.", "invalid_id");

    const service = context.serviceClient;
    const owner = context.user.id;
    const found = await service.from(TABLE[kind]).select("*").eq("id", id).eq("owner_id", owner).maybeSingle();
    if (found.error) throw found.error;
    // Somebody else's, or already gone: the same answer, so ids cannot be probed.
    if (!found.data) throw new HttpError(404, "Topilmadi yoki allaqachon o‘chirilgan.", "not_found");
    const row = found.data as Record<string, unknown>;
    const status = typeof row.status === "string" ? row.status : "";

    if (kind === "presentation" && BUSY_DECK.has(status)) {
      throw new HttpError(409, "Taqdimot hali yaratilmoqda — tayyor bo‘lgach o‘chiring.", "still_generating");
    }
    if (kind === "academic" && BUSY_WORK.has(status)) {
      throw new HttpError(409, "Ilmiy ish hali yozilmoqda — tugagach o‘chiring.", "still_generating");
    }
    if (kind === "game") {
      if (status === "generating") throw new HttpError(409, "O‘yin hali yaratilmoqda — tayyor bo‘lgach o‘chiring.", "still_generating");
      const listed = await service.from("marketplace_products").select("id", { count: "exact", head: true }).eq("game_id", id);
      if (!listed.error && (listed.count ?? 0) > 0) {
        throw new HttpError(409, "Bu o‘yin do‘konda sotuvda. Avval uni do‘kondan olib tashlang.", "listed_in_shop");
      }
    }

    // What to sweep from storage once the row is gone, gathered while it still exists.
    const sweep: { bucket: string; paths: string[] }[] = [];
    if (kind === "presentation") {
      for (const bucket of ["user-uploads", "stock-images", "generated-images", "presentation-assets", "exports"]) {
        sweep.push({ bucket, paths: await filesUnder(service, bucket, `${owner}/${id}`) });
      }
    } else if (kind === "portrait") {
      sweep.push({ bucket: "exports", paths: [String(row.sheet_path ?? "")] });
      sweep.push({ bucket: "user-uploads", paths: [String(row.source_path ?? "")] });
    } else if (kind === "objective") {
      sweep.push({ bucket: "exports", paths: ["docx", "pdf"].map((format) => `${owner}/obyektivka/${id}.${format}`) });
    } else if (kind === "academic") {
      sweep.push({ bucket: "exports", paths: ["docx", "pdf"].map((format) => `${owner}/ilmiy/${id}.${format}`) });
    } else if (kind === "survey") {
      const responses = await service.from("survey_responses").select("id").eq("form_id", id);
      const ids = (responses.data ?? []).map((response) => response.id as string);
      if (ids.length) {
        const files = await service.from("survey_answer_files").select("storage_path").in("response_id", ids);
        sweep.push({ bucket: "survey-uploads", paths: (files.data ?? []).map((file) => String(file.storage_path ?? "")) });
      }
    }
    // Only ever this owner's files, whatever a row happened to point at. A
    // survey's uploads were made by its respondents and live under their ids,
    // so those are trusted because they came from this survey's own rows.
    for (const entry of sweep) {
      entry.paths = entry.paths.filter((path) =>
        Boolean(path) && !path.includes("..") && (entry.bucket === "survey-uploads" || path.startsWith(`${owner}/`)));
    }

    const removed = await service.from(TABLE[kind]).delete().eq("id", id).eq("owner_id", owner);
    if (removed.error) {
      if (removed.error.code === "23503") {
        throw new HttpError(409, "Bu ish boshqa joyda ishlatilmoqda, shuning uchun hozir o‘chirib bo‘lmaydi.", "in_use");
      }
      throw removed.error;
    }

    for (const entry of sweep) await removeFiles(service, entry.bucket, entry.paths);
    console.log(JSON.stringify({ event: "work_deleted", kind, id, files: sweep.reduce((sum, entry) => sum + entry.paths.length, 0) }));
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    return errorResponse(error);
  }
});
