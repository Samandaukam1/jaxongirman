/**
 * A test as a PDF to print (`kind: "sheet"`), or its answer key (`"key"`).
 *
 * The owner's only. The file goes to their own folder in `exports`, like every
 * other document the app makes, and the app signs a short link to it.
 */
import { toNewAlphabet } from "../_shared/alphabet.ts";
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { renderTestKeyPdf, renderTestPdf, type PrintableTest, type TestLanguage } from "../_shared/test-pdf.ts";

type Body = { testId?: string; kind?: "sheet" | "key" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(["uz", "en", "ru", "tr"]);

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 2_000);
    const testId = (body.testId ?? "").trim();
    const kind = body.kind === "key" ? "key" : "sheet";
    if (!UUID.test(testId)) throw new HttpError(400, "Test tanlanmadi.", "invalid_id");

    const service = context.serviceClient;
    const test = await service
      .from("tests")
      .select("id, owner_id, title, language, option_count, print_layout, status")
      .eq("id", testId)
      .maybeSingle();
    if (test.error || !test.data || test.data.owner_id !== context.user.id) {
      throw new HttpError(404, "Test topilmadi.", "test_not_found");
    }
    const questions = await service
      .from("test_questions")
      .select("prompt, options, correct, position, created_at, id")
      .eq("test_id", testId)
      .order("position")
      .order("created_at")
      .order("id");
    if (questions.error) throw questions.error;
    if (!questions.data?.length) throw new HttpError(422, "Testda hali savol yo‘q.", "test_empty");
    if (questions.data.some((question) => !String(question.prompt ?? "").trim())) {
      throw new HttpError(422, "Bo‘sh savol bor: avval uni to‘ldiring.", "test_incomplete");
    }

    const language = (LANGUAGES.has(test.data.language) ? test.data.language : "uz") as TestLanguage;
    // Uzbek is printed in the updated alphabet, typed questions as well as written ones.
    const spell = language === "uz" ? toNewAlphabet : (text: string) => text;
    const printable: PrintableTest = {
      id: test.data.id,
      title: spell(test.data.title || "Test"),
      language,
      optionCount: test.data.option_count,
      layout: test.data.print_layout === "separate" ? "separate" : "combined",
      questions: questions.data.map((question) => ({
        prompt: spell(String(question.prompt ?? "")),
        options: (Array.isArray(question.options) ? question.options : []).map((option) => spell(String(option ?? ""))),
        correct: question.correct,
      })),
    };
    const bytes = kind === "key" ? await renderTestKeyPdf(printable) : await renderTestPdf(printable);

    const path = `${context.user.id}/tests/${testId}-${kind}.pdf`;
    const upload = await service.storage.from("exports").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw upload.error;
    return json({ ok: true, storagePath: path, sizeBytes: bytes.byteLength });
  } catch (error) {
    return errorResponse(error);
  }
});
