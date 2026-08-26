/**
 * A real slide, on demand, for a design nobody has sold yet.
 *
 * Every design in the console is judged on placeholder text — "Sarlavha",
 * "Kichik sarlavha", three identical bullets — and placeholder text is exactly
 * the content a layout cannot fail on. It is always short, always the same
 * length in every slot, and never contains the eleven-syllable Uzbek compound
 * that turns a two-line title into four. So a design ships looking finished and
 * breaks on the first deck a customer generates.
 *
 * This runs the production content path instead: the blueprint's own slots and
 * budgets, the same writer the generator uses, the same fit check, the same
 * photo search. What comes back is what a customer would get on that topic, in
 * that language, and if it overflows here it would have overflowed there.
 *
 * Only the words are made here. Geometry, colour and type stay the design's,
 * and the rendering happens in the browser that asked — the console already
 * carries the engine, so a sample costs one model call rather than a round trip
 * per theme the administrator tries.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { readDocument } from "../_shared/jslayd/serialize.ts";
import { readSample, sampleBrief, samplePrompt, sampleSchema, type SampleAnswer } from "../_shared/jslayd/sample.ts";
import { searchUnsplash, unsplashConfigured } from "../_shared/providers/unsplash.ts";
import { queryLadder } from "../_shared/unsplash-results.ts";
import { ProviderUnavailable, userFacingFailure } from "../_shared/writer.ts";

type Body = {
  designId?: string;
  archetypeId?: string;
  topic?: string;
  language?: string;
};

/** Long enough to write a slide, short enough that a runaway answer stops. */
const MAX_TOKENS = 1200;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requestContext(request);
    const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
    if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");

    const body = await bodyJson<Body>(request);
    const designId = (body.designId ?? "").trim();
    const topic = (body.topic ?? "").trim();
    const language = (body.language ?? "uz").trim() || "uz";
    if (!designId) throw new HttpError(400, "designId yuborilmadi.", "missing_design");
    if (!topic) throw new HttpError(400, "Mavzu yozilmadi.", "missing_topic");
    if (topic.length > 200) throw new HttpError(400, "Mavzu juda uzun.", "topic_too_long");

    const design = await context.serviceClient
      .from("presentation_designs")
      .select("id, slug, compiled_config")
      .eq("id", designId)
      .maybeSingle();
    if (design.error || !design.data) throw new HttpError(404, "Dizayn topilmadi.", "design_missing");

    const read = readDocument(design.data.compiled_config);
    if (!read.document) throw new HttpError(422, "Dizayn hujjati o‘qilmadi.", "document_unreadable");
    const document = read.document;

    const wanted = (body.archetypeId ?? "").trim();
    const archetype = wanted
      ? document.archetypes.find((entry) => entry.id === wanted)
      : document.archetypes.find((entry) => entry.purpose === "cover") ?? document.archetypes[0];
    if (!archetype) throw new HttpError(404, "Blueprint topilmadi.", "archetype_missing");

    const brief = sampleBrief(document, archetype, { language });
    if (!brief.slots.length) {
      // A decorative divider has nothing to write. Answering with an empty
      // slide is honest and lets the console draw it rather than show an error
      // for a blueprint that is behaving correctly.
      return json({ archetypeId: archetype.id, slide: null, outcomes: [], photo: null, empty: true });
    }

    const writer = geminiWriter();
    const answer = await writer.structured<SampleAnswer>({
      prompt: samplePrompt(brief, topic),
      system: "Siz taqdimot uchun matn yozasiz. Faqat so‘ralgan joylarga, faqat so‘ralgan uzunlikda.",
      schemaName: "sample_slide",
      schema: sampleSchema(brief),
      maxOutputTokens: MAX_TOKENS,
      // One attempt: this is a preview an administrator is waiting on, and a
      // second call to say the same thing is thirty seconds they spend staring.
      attempts: 1,
    });

    const result = readSample(answer.data, document, archetype, { language });

    /**
     * The picture, when the design has somewhere to put one.
     *
     * Searched here rather than in the browser because the key is a server
     * secret, and because the ladder — the query, then something broader, then
     * the theme's own subject — is the generator's, not a second implementation
     * that finds different photographs for the same deck.
     */
    let photo = null;
    if (result.imageQuery && unsplashConfigured()) {
      for (const query of queryLadder(result.imageQuery)) {
        photo = await searchUnsplash(query, "landscape");
        if (photo) break;
      }
    }

    return json({
      archetypeId: archetype.id,
      slide: result.slide,
      outcomes: result.outcomes,
      imageQuery: result.imageQuery,
      photo,
      empty: false,
      // What it cost and who wrote it, so the console can say so rather than
      // present a model's paragraph as the design's own.
      writer: { model: answer.model, attempts: answer.attempts, usage: answer.usage },
    });
  } catch (error) {
    if (error instanceof ProviderUnavailable) {
      const failure = userFacingFailure(error);
      return json({ error: failure.message, code: failure.code }, 503);
    }
    return errorResponse(error);
  }
});
