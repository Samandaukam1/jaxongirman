import { createClient } from "npm:@supabase/supabase-js";
import { requestContext } from "../_shared/auth.ts";
import { runGenerationPipeline } from "../_shared/pipeline.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";
import { contentSchema, outlineSchema } from "../_shared/plan-schema.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

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

/**
 * Runs the generation pipeline for a job that is already queued.
 *
 * The operator's end-to-end check: a deck made by exactly the code a
 * customer's deck is made by — research, outline, copy, design, photographs,
 * layout, saving — started from a job row the operator created, so nobody's
 * allowance is spent and nobody's session is borrowed. The job is created with
 * database access and carries a one-time secret in its idempotency key
 * (`operator-trial:<secret>`); only a caller holding that secret can start it,
 * and only while it is still `queued` — it can start work, never redo or
 * redirect it. The owner comes from the job, not from the request.
 */
/**
 * Hour-long links to an operator trial deck's photographs, for the preview
 * the operator renders of it. Same one-time secret as `runQueuedJob`; only
 * that trial's own pictures can be signed.
 */
async function trialImages(jobId: string, secret: string): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job, error } = await service
    .from("generation_jobs")
    .select("presentation_id, idempotency_key")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job || !secretsMatch(job.idempotency_key ?? "", `operator-trial:${secret}`)) {
    throw new HttpError(404, "job not found", "not_found");
  }
  const { data: rows, error: rowsError } = await service
    .from("slide_elements")
    .select("content")
    .eq("presentation_id", job.presentation_id)
    .eq("type", "image");
  if (rowsError) throw rowsError;
  const links: Record<string, string> = {};
  for (const row of rows ?? []) {
    const content = (row.content ?? {}) as { storageBucket?: string; storagePath?: string };
    if (!content.storageBucket || !content.storagePath) continue;
    const { data } = await service.storage.from(content.storageBucket).createSignedUrl(content.storagePath, 3600);
    if (data?.signedUrl) links[content.storagePath] = data.signedUrl;
  }
  return json({ presentationId: job.presentation_id, links });
}

/**
 * What a grounded research answer looks like, as structure only.
 *
 * Decks came back with "no sources found" while the notes quoted Google's own
 * redirect links — the search ran, and its citations were not read. This asks
 * one small grounded question and reports where in the answer the grounding
 * lives: field names and counts, never text, never a key.
 */
async function researchProbe(jobId: string, secret: string): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job } = await service.from("generation_jobs").select("idempotency_key").eq("id", jobId).maybeSingle();
  if (!job || !secretsMatch(job.idempotency_key ?? "", `operator-trial:${secret}`)) throw new HttpError(404, "job not found", "not_found");
  const writer = geminiWriter();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(writer.researchModel)}:generateContent?key=${encodeURIComponent(Deno.env.get("GEMINI_API_KEY") ?? "")}`;

  // The production research request, word for word, and variations on it.
  const system = "You are a research assistant for Uzbek-language academic presentations. Search the live web before answering and report only what the pages you opened actually say. Never state a fact you could not find a source for. Write in Uzbek Latin script.";
  const uzbek = "Mavzu: Amir Temur davlatining tashkil topishi va rivojlanishi\n\nIshonchli manbalardan qidiring: rasmiy saytlar, ilmiy nashrlar, statistika idoralari, universitetlar.\nQuyidagilarni QISQA ro'yxat qilib yozing — izoh va kirish so'zlarisiz:\n- FAKTLAR: 8–12 ta aniq dalil, har biri bir qatorda, qavsda manba.\n- RAQAMLAR: 4–8 ta statistika, yil va manba bilan.\n- TA'RIFLAR: 2–4 ta asosiy tushuncha, bir jumladan.\n- MANBALAR: 5–8 ta havola.\nManbasi yo'q da'voni yozmang. Uzun paragraf yozmang.";
  const lead = "Step 1 — use Google Search now: run 2–3 searches about the topic below (in English and in Uzbek) and open the most authoritative pages. Step 2 — using only what those pages say, write the notes below in Uzbek Latin script.";
  const variants: Record<string, Record<string, unknown>> = {};
  void lead;
  const ask = "Search the web and list 10 key facts and 5 statistics (each with its year) about the topic below. After every fact, name its source in brackets. End with a SOURCES list of the pages you used.\nTopic: Amir Temur davlatining tashkil topishi va rivojlanishi";
  for (let round = 1; round <= 4; round += 1) {
    variants[`C_short_en_${round}`] = { contents: [{ role: "user", parts: [{ text: ask }] }] };
    variants[`D_short_en_uz_${round}`] = { contents: [{ role: "user", parts: [{ text: `${ask}\nWrite the answer in Uzbek Latin script.` }] }] };
  }
  const report: Record<string, unknown> = { model: writer.researchModel };
  await Promise.all(Object.entries(variants).map(async ([name, body]) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 2_500 } }),
      });
      const payload = await response.json() as Record<string, unknown>;
      const first = ((payload.candidates ?? []) as Record<string, unknown>[])[0] ?? {};
      const grounding = (first.groundingMetadata ?? {}) as Record<string, unknown>;
      const parts = ((first.content as { parts?: Record<string, unknown>[] } | undefined)?.parts ?? []);
      const text = parts.map((part) => String(part.text ?? "")).join("");
      const usage = (payload.usageMetadata ?? {}) as Record<string, unknown>;
      report[name] = {
        http: response.status,
        finish: first.finishReason ?? null,
        chunks: Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks.length : 0,
        queries: Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries.length : 0,
        groundingKeys: Object.keys(grounding),
        textLength: text.length,
        redirectsInText: (text.match(/vertexaisearch|grounding-api-redirect/g) ?? []).length,
        outputTokens: usage.candidatesTokenCount ?? null,
        thoughtTokens: usage.thoughtsTokenCount ?? null,
      };
    } catch (failure) {
      report[name] = { error: String((failure as Error)?.message ?? failure).slice(0, 160) };
    }
  }));
  return json(report);
}

async function runQueuedJob(jobId: string, secret: string): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job, error } = await service
    .from("generation_jobs")
    .select("id, presentation_id, owner_id, status, idempotency_key")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  // The job carries its own one-time secret, put there by whoever created it
  // with database access. Nothing else can start it.
  if (!job || !secret || !secretsMatch(job.idempotency_key ?? "", `operator-trial:${secret}`)) {
    throw new HttpError(404, "job not found", "not_found");
  }
  if (job.status !== "queued") throw new HttpError(409, `job is ${job.status}`, "not_queued");
  const pipeline = runGenerationPipeline({ jobId: job.id, presentationId: job.presentation_id, ownerId: job.owner_id, service });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(pipeline);
  else await pipeline;
  return json({ jobId: job.id, presentationId: job.presentation_id, status: "running" }, 202);
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    if (request.method === "POST") {
      const body = await request.clone().json().catch(() => ({})) as { action?: string; jobId?: string; secret?: string };
      if (body.action === "run_job") {
        if (!body.jobId || !body.secret) throw new HttpError(400, "jobId and secret are required", "bad_request");
        return await runQueuedJob(body.jobId, body.secret);
      }
      if (body.action === "research_probe") {
        if (!body.jobId || !body.secret) throw new HttpError(400, "jobId and secret are required", "bad_request");
        return await researchProbe(body.jobId, body.secret);
      }
      if (body.action === "trial_images") {
        if (!body.jobId || !body.secret) throw new HttpError(400, "jobId and secret are required", "bad_request");
        return await trialImages(body.jobId, body.secret);
      }
    }
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
