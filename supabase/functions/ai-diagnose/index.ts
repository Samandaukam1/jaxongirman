import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

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

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requestContext(request);

    // Admin only. Which models are configured is operational detail, and a
    // probe costs a request — neither belongs on an endpoint members can call.
    const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
    if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");

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
