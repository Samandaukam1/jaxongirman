/**
 * Reads one photographed answer sheet of a test (`_shared/omr.ts`).
 *
 * The phone sends the photo as a JPEG, already made smaller; it is decoded,
 * read, and thrown away — a sheet carries a child's name, and nothing here
 * needs to keep it. What comes back is what was read, with every doubtful row
 * flagged and where each bubble was found, so the app can draw the reading
 * over the photo and the teacher can correct it before it is saved.
 *
 * Only the test's owner may scan against it: the key is theirs.
 */
import jpeg from "npm:jpeg-js@0.4.4";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { readSheet, toGray } from "../_shared/omr.ts";
import { testFingerprint } from "../_shared/test-sheet.ts";

type Body = { testId?: string; image?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** About 6 MB of JPEG; the app sends well under a megabyte. */
const MAX_BODY = 8_500_000;

const MESSAGES: Record<string, string> = {
  no_markers: "Varaqning to‘rt burchagidagi qora kvadratlar ko‘rinmadi. Javoblar varag‘ini to‘liq, yorug‘ joyda suratga oling.",
  not_a_sheet: "Bu javoblar varag‘iga o‘xshamadi. Varaqni ramkaga to‘liq sig‘diring va qayta suratga oling.",
  other_test: "Bu varaq boshqa testniki yoki test savollari o‘zgargandan oldin chop etilgan. Shu testning yangi PDF varag‘ini ishlating.",
};

function bytesOf(base64: string): Uint8Array {
  const clean = base64.replace(/^data:image\/[a-z]+;base64,/i, "").replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, MAX_BODY);
    const testId = (body.testId ?? "").trim();
    if (!UUID.test(testId)) throw new HttpError(400, "Test tanlanmadi.", "invalid_id");
    if (typeof body.image !== "string" || body.image.length < 1000) throw new HttpError(400, "Surat kelmadi.", "no_image");

    const test = await context.serviceClient
      .from("tests")
      .select("id, owner_id, question_count, option_count")
      .eq("id", testId)
      .maybeSingle();
    if (test.error || !test.data || test.data.owner_id !== context.user.id) throw new HttpError(404, "Test topilmadi.", "test_not_found");
    if (test.data.question_count < 1) throw new HttpError(422, "Testda hali savol yo‘q.", "test_empty");

    let decoded: { width: number; height: number; data: Uint8Array };
    try {
      decoded = jpeg.decode(bytesOf(body.image), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 300 });
    } catch {
      throw new HttpError(400, "Surat ochilmadi. Qayta suratga oling.", "bad_image");
    }

    const started = performance.now();
    const result = readSheet(toGray(decoded.data, decoded.width, decoded.height, 4), {
      questions: test.data.question_count,
      options: test.data.option_count,
      fingerprint: testFingerprint(test.data.id),
    });
    console.log(JSON.stringify({
      event: "test_scan", test_id: testId, ok: result.ok, code: result.ok ? null : result.code,
      flagged: result.ok ? result.flags.filter(Boolean).length : null, ms: Math.round(performance.now() - started),
      width: decoded.width, height: decoded.height,
    }));
    if (!result.ok) return json({ ok: false, code: result.code, error: MESSAGES[result.code] ?? MESSAGES.not_a_sheet }, 200);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
});
