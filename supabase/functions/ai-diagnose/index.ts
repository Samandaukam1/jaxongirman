import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";
import { contentSchema, outlineSchema } from "../_shared/plan-schema.ts";

/**
 * Whether the text pipeline will work, asked before somebody's deck asks it.
 *
 * A generation that failed at twenty-eight per cent told us OpenAI had been
 * reached. It did not tell us whether Gemini had been tried, whether its key
 * was visible to this runtime, or whether it had answered and been rejected —
 * three different faults with three different fixes, and no way to tell them
 * apart from the outside. That is what this is for.
 *
 * Every answer is a boolean, a model name or a reason code. No key, no prompt
 * and no provider sentence is ever returned: a diagnosis that leaks a
 * credential is worse than the fault it describes.
 */

function secretsMatch(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Two ways in, both operator-level.
 *
 * An admin's own session, for the button in the console — and the service-role
 * key, for whoever is running the deploy. The second matters because the moment
 * you most need to know whether the writing model answers is the minute after
 * you changed it, and nobody has a browser open during a deploy.
 *
 * The service key already reads and writes everything in the project. Letting
 * it read three booleans adds no exposure; refusing it would only mean the
 * check gets skipped.
 */
async function authorize(request: Request): Promise<void> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const presented = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (serviceKey && presented && secretsMatch(presented, serviceKey)) return;

  const context = await requestContext(request);
  const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
  if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    await authorize(request);

    const writer = geminiWriter();

    const report: Record<string, unknown> = {
      gemini_configured: writer.configured,
      gemini_research_model: writer.researchModel,
      gemini_writing_model: writer.writingModel,
      // Named per operation because that is how the question is asked when a
      // generation fails: which stage went where.
      research_provider: "google",
      outline_provider: "google",
      writing_provider: "google",
      rewrite_provider: "google",
      openai_text_calls: 0,
    };

    /**
     * A real request, because "the key is set" and "the key works" are
     * different claims and only the second one matters.
     *
     * Deliberately tiny: two words against a trivial schema costs almost
     * nothing and still exercises the whole path — auth, the model name, the
     * structured-output contract and the response shape.
     */
    if (writer.configured) {
      try {
        const probe = await writer.structured<{ ok: string }>({
          prompt: "Reply with the word ok.",
          schemaName: "diagnose",
          schema: { type: "object", properties: { ok: { type: "string" } }, required: ["ok"] },
          maxOutputTokens: 32,
        });
        report.gemini_writing_probe = "ok";
        report.gemini_writing_attempts = probe.attempts;
      } catch (failure) {
        report.gemini_writing_probe = "failed";
        report.gemini_writing_reason = failure instanceof ProviderUnavailable ? failure.reason : "unknown";
      }

      try {
        const probe = await writer.research({ prompt: "Reply with the word ok.", maxOutputTokens: 32 });
        report.gemini_research_probe = "ok";
        report.gemini_grounded_search = probe.groundedSearch;
      } catch (failure) {
        report.gemini_research_probe = "failed";
        report.gemini_research_reason = failure instanceof ProviderUnavailable ? failure.reason : "unknown";
        report.gemini_research_detail = failure instanceof Error ? failure.message.slice(0, 300) : "";
      }

      /**
       * The schemas a deck is actually written against.
       *
       * A two-word answer against `{ ok: string }` proves the key works and
       * nothing else — the outline and the slide copy are the requests that
       * have been failing, and they are refused for what is in them rather
       * than for reaching the wrong address. Asked with one slide and a low
       * token cap, so the check costs almost nothing.
       */
      for (const [name, schema] of [
        ["outline", outlineSchema(1)],
        ["content", contentSchema(1)],
      ] as const) {
        try {
          await writer.structured({
            prompt: "Bitta namunaviy slayd uchun sxemaga mos JSON qaytaring.",
            schemaName: `probe_${name}`,
            schema,
            maxOutputTokens: 700,
          });
          report[`gemini_${name}_schema`] = "ok";
        } catch (failure) {
          report[`gemini_${name}_schema`] = "failed";
          // The whole sentence, field violation included. This is the line that
          // says which key Gemini refused.
          report[`gemini_${name}_detail`] = failure instanceof Error ? failure.message.slice(0, 400) : "";
        }
      }
    }

    const healthy = writer.configured && report.gemini_writing_probe === "ok";
    report.verdict = healthy
      ? "Matn bosqichlari Gemini orqali ishlaydi."
      : writer.configured
        ? "GEMINI_API_KEY o‘rnatilgan, lekin Gemini javob bermayapti."
        : "GEMINI_API_KEY o‘rnatilmagan — generatsiya boshlanmaydi.";

    return json(report);
  } catch (error) {
    return errorResponse(error);
  }
});
