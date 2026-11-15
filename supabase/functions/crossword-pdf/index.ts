/**
 * A crossword as a PDF to print: the grid and clues, then the answers.
 *
 * For the owner, and for anyone who may host the crossword (bought it, or it
 * is free) — the same people `game_can_host` lets put it on a board. The file
 * goes to the caller's own folder in `exports`, like every other document the
 * app makes, and the app signs a short link to it.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { readCrossword, type CrosswordLanguage } from "../_shared/crossword.ts";
import { renderCrosswordPdf } from "../_shared/crossword-pdf.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Body = { gameId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(["uz", "en", "ru", "tr"]);

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 2_000);
    const gameId = (body.gameId ?? "").trim();
    if (!UUID.test(gameId)) throw new HttpError(400, "Krossvord tanlanmadi.", "invalid_id");

    const service = context.serviceClient;
    const game = await service.from("games").select("id, owner_id, title, language, kind").eq("id", gameId).maybeSingle();
    if (game.error || !game.data || game.data.kind !== "crossword") {
      throw new HttpError(404, "Krossvord topilmadi.", "crossword_not_found");
    }
    if (game.data.owner_id !== context.user.id) {
      const allowed = await service.rpc("game_can_host", { p_game_id: gameId, p_user_id: context.user.id });
      if (allowed.error || allowed.data !== true) throw new HttpError(404, "Krossvord topilmadi.", "crossword_not_found");
    }

    const question = await service
      .from("game_questions")
      .select("config")
      .eq("game_id", gameId)
      .eq("type", "crossword")
      .order("position")
      .limit(1)
      .maybeSingle();
    const crossword = readCrossword(question.data?.config);
    if (question.error || !crossword || !crossword.words.every((word) => word.answer)) {
      throw new HttpError(422, "Krossvord to‘liq emas.", "crossword_incomplete");
    }

    const language = (LANGUAGES.has(game.data.language) ? game.data.language : "uz") as CrosswordLanguage;
    const bytes = await renderCrosswordPdf({ title: game.data.title || "Krossvord", language, crossword });

    const path = `${context.user.id}/crossword/${gameId}.pdf`;
    const upload = await service.storage.from("exports").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw upload.error;

    return json({ ok: true, storagePath: path, sizeBytes: bytes.byteLength });
  } catch (error) {
    return errorResponse(error);
  }
});
