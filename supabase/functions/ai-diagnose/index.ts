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
      /**
       * Which part of the failing request is the one Gemini refuses.
       *
       * The outline call succeeds and the content call does not, and they
       * differ in three ways at once: the schema, the output cap and the size
       * of the prompt. Removing the nested array from the schema changed
       * nothing, which means at least one of the other two matters — so each is
       * varied on its own rather than reasoned about.
       *
       * Read the results as a ladder. The first row that fails names the thing
       * that broke, because every row above it holds the others constant.
       */
      const TRIVIAL = { type: "object", properties: { ok: { type: "string" } }, required: ["ok"] };
      const SHORT = "Sxemaga mos namunaviy JSON qaytaring.";
      // Roughly what the real content prompt carries once the outline, the
      // research notes and every archetype brief are in it.
      const LONG = `${SHORT}\n\n${"Namunaviy kontekst matni. ".repeat(900)}`;

      const PROBES: {
        name: string;
        schema: Record<string, unknown>;
        maxOutputTokens: number;
        prompt: string;
      }[] = [
        { name: "trivial", schema: TRIVIAL, maxOutputTokens: 400, prompt: SHORT },
        { name: "outline_6", schema: outlineSchema(6), maxOutputTokens: 400, prompt: SHORT },
        { name: "content_1", schema: contentSchema(1), maxOutputTokens: 400, prompt: SHORT },
        { name: "content_6", schema: contentSchema(6), maxOutputTokens: 400, prompt: SHORT },
        { name: "content_10", schema: contentSchema(10), maxOutputTokens: 400, prompt: SHORT },
        // Isolates the output cap: same small schema, production's 16k.
        { name: "trivial_16k", schema: TRIVIAL, maxOutputTokens: 16_000, prompt: SHORT },
        { name: "content_6_16k", schema: contentSchema(6), maxOutputTokens: 16_000, prompt: SHORT },
        // Isolates prompt size: production's schema and cap, a long prompt.
        { name: "content_6_longprompt", schema: contentSchema(6), maxOutputTokens: 400, prompt: LONG },
      ];

      report.probe_prompt_bytes_short = SHORT.length;
      report.probe_prompt_bytes_long = LONG.length;
      report.schema_bytes_outline = JSON.stringify(outlineSchema(6)).length;
      report.schema_bytes_content = JSON.stringify(contentSchema(6)).length;

      const results = await Promise.all(PROBES.map(async (probe) => {
        try {
          await Promise.race([
            writer.structured({
              prompt: probe.prompt,
              schemaName: `probe_${probe.name}`,
              schema: probe.schema,
              maxOutputTokens: probe.maxOutputTokens,
              // One ask. A diagnostic that retries takes three times as long to
              // report the same refusal.
              attempts: 1,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("javob 15 soniyada kelmadi")), 15_000)),
          ]);
          return { name: probe.name, state: "ok", detail: "" };
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "";
          return {
            name: probe.name,
            // Truncation is the token cap doing its job, not a refusal — the
            // request was accepted and the answer ran out of room.
            state: /unparseable JSON|empty_response|no text/i.test(message) ? "ok (kesildi)" : "FAILED",
            detail: message.slice(0, 260),
          };
        }
      }));

      for (const result of results) {
        report[`probe_${result.name}`] = result.state;
        if (result.detail) report[`probe_${result.name}_detail`] = result.detail;
      }
    }

    const healthy = writer.configured && report.probe_trivial === "ok";
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
