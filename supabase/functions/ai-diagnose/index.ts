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
       * Which construct Gemini refuses, asked one at a time.
       *
       * The outline schema is accepted and the content schema is not, every
       * time — so the fault is a shape that only the second one contains, and
       * there are exactly two candidates: an object marked nullable, and an
       * array whose items are arrays. Probing the whole schema again would only
       * repeat what is already known.
       *
       * Each is the smallest request that contains the construct and nothing
       * else, so a failure names the construct rather than the schema.
       */
      const PROBES: { name: string; schema: Record<string, unknown> }[] = [
        {
          name: "nullable_object",
          schema: {
            type: "object",
            properties: {
              quote: {
                type: "object", nullable: true,
                properties: { text: { type: "string" }, attribution: { type: "string" } },
                required: ["text", "attribution"],
              },
            },
            required: ["quote"],
          },
        },
        {
          name: "array_of_array",
          schema: {
            type: "object",
            properties: {
              rows: {
                type: "array", minItems: 1, maxItems: 3,
                items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
              },
            },
            required: ["rows"],
          },
        },
        {
          name: "nullable_string",
          schema: {
            type: "object",
            properties: { body: { type: "string", nullable: true } },
            required: ["body"],
          },
        },
        { name: "outline_real", schema: outlineSchema(1) },
        { name: "content_real", schema: contentSchema(1) },
      ];

      for (const probe of PROBES) {
        try {
          await writer.structured({
            prompt: "Sxemaga mos namunaviy JSON qaytaring.",
            schemaName: `probe_${probe.name}`,
            schema: probe.schema,
            maxOutputTokens: 600,
          });
          report[`probe_${probe.name}`] = "ok";
        } catch (failure) {
          report[`probe_${probe.name}`] = "FAILED";
          // The whole sentence, field violation included — the line that names
          // the key Gemini refused.
          report[`probe_${probe.name}_detail`] = failure instanceof Error ? failure.message.slice(0, 320) : "";
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
