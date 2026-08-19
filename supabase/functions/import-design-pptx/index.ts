/**
 * Turning an uploaded PowerPoint template into a design.
 *
 * The admin uploads the file to the private `design-source` bucket and sends
 * the path; this reads it, inspects it, converts it, asks the model what its
 * pages are for, and writes the design. The upload is a separate step for the
 * same reason it is in `import-pptx`: storage already accepts a large file
 * directly and enforces the folder while doing it, and pushing fifty megabytes
 * through a function body to achieve the same thing is a bad trade.
 *
 * Two steps, and the first one writes nothing. `inspect` answers what would
 * happen — how many pages, what they appear to be for, what was refused, and
 * whether this exact file is already a design — so an admin decides before a
 * catalogue entry exists rather than after. `import` performs it.
 *
 * The design row is opened through `admin_save_design` with the *caller's*
 * client, so the existing admin check, the slug rules and the audit trail all
 * apply exactly as they do to a hand-written design. Everything after that runs
 * as the service role, which is why the caller is checked for admin first.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { contentHash } from "../_shared/jslayd/serialize.ts";
import { renderPreview } from "../_shared/jslayd/render.ts";
import {
  DESIGN_CLASSIFIER_NAME, DESIGN_CLASSIFIER_SCHEMA, SLIDE_CLASSIFIER_NAME, SLIDE_CLASSIFIER_SCHEMA,
  designClassifierPrompt, factsFor, readDesignKeywords, readSlideProfiles, slideClassifierPrompt,
} from "../_shared/pptx-classify.ts";
import { toJslaydDocument } from "../_shared/pptx-design.ts";
import { inspectPackage, packageHash, MAX_TEMPLATE_SLIDES } from "../_shared/pptx-safety.ts";
import { PptxError, readPptx } from "../_shared/pptx.ts";
import { unzip, ZipError } from "../_shared/unzip.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

const BUCKET = "design-source";

type Body = {
  storagePath?: string;
  originalName?: string;
  name?: string;
  slug?: string;
  tier?: string;
  description?: string;
  premium?: boolean;
  step?: "inspect" | "import";
};

const TIERS = ["simple", "good", "great", "super_professional"];

/** Only an administrator imports a design, and only their own upload folder. */
async function adminContext(request: Request) {
  const context = await requestContext(request);
  const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
  if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");
  return context;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await adminContext(request);
    const body = await bodyJson<Body>(request);

    const storagePath = (body.storagePath ?? "").trim();
    if (!storagePath) throw new HttpError(400, "Fayl manzili yuborilmadi.", "missing_path");
    // The path is not allowed to wander out of the bucket's own namespace.
    if (storagePath.includes("..") || storagePath.startsWith("/")) {
      throw new HttpError(400, "Fayl manzili noto‘g‘ri.", "bad_path");
    }

    const download = await context.serviceClient.storage.from(BUCKET).download(storagePath);
    if (download.error || !download.data) {
      throw new HttpError(404, "Yuklangan fayl topilmadi.", "file_missing");
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    let entries;
    try {
      entries = await unzip(bytes);
    } catch (error) {
      if (error instanceof ZipError) throw new HttpError(422, error.message, "bad_archive");
      throw error;
    }

    // What the package is allowed to contain, before anything reads its meaning.
    const report = inspectPackage(entries);
    if (!report.ok) {
      return json({
        ok: false,
        code: "rejected",
        problems: report.problems,
        maxSlides: MAX_TEMPLATE_SLIDES,
      }, 422);
    }

    /**
     * Whether this exact file is already a design.
     *
     * By hash rather than by name: `shablon.pptx` and `shablon-final.pptx` are
     * one template and checking by filename means finding that out never.
     */
    const hash = await packageHash(entries);
    const existing = await context.serviceClient
      .from("design_source_assets")
      .select("design_id, original_filename, presentation_designs(name, slug)")
      .eq("content_hash", hash)
      .maybeSingle();
    if (existing.data) {
      return json({
        ok: false,
        code: "duplicate",
        designId: existing.data.design_id,
        design: existing.data.presentation_designs,
        message: "Bu shablon allaqachon import qilingan.",
      }, 409);
    }

    let deck;
    try {
      deck = readPptx(entries);
    } catch (error) {
      if (error instanceof PptxError) throw new HttpError(422, error.message, "unreadable");
      throw error;
    }

    const name = (body.name ?? deck.title ?? "Yangi dizayn").trim().slice(0, 80);
    const slug = (body.slug ?? "").trim().toLowerCase();
    const tier = TIERS.includes(body.tier ?? "") ? body.tier! : "great";

    const draft = toJslaydDocument(deck, {
      name,
      // `inspect` writes nothing, so a placeholder slug is harmless there and a
      // real one is required the moment a row is created.
      slug: slug || "import-oldindan-korish",
      tier: tier as never,
      premium: body.premium ?? false,
      ...(body.description ? { description: body.description } : {}),
    });

    const facts = factsFor(draft.pages, deck.slides);
    const warnings = [...draft.warnings];

    /* ------------------------------------------------------- classification */

    const writer = geminiWriter();
    let slideAnswer: unknown = null;
    let topicAnswer: unknown = null;

    const topics = await context.serviceClient
      .from("design_topics")
      .select("slug, label_uz")
      .order("sort_order");
    const taxonomy = (topics.data ?? []).map((row) => ({ slug: row.slug as string, label: row.label_uz as string }));
    const allowed = new Set(taxonomy.map((topic) => topic.slug));

    if (writer.configured) {
      // Both are asked at once: neither depends on the other, and a template of
      // twenty-five pages is already the slowest part of this request.
      const [slides, subjects] = await Promise.allSettled([
        writer.structured<unknown>({
          prompt: slideClassifierPrompt(facts),
          schemaName: SLIDE_CLASSIFIER_NAME,
          schema: SLIDE_CLASSIFIER_SCHEMA,
          maxOutputTokens: 4000,
          attempts: 2,
        }),
        writer.structured<unknown>({
          prompt: designClassifierPrompt({
            name,
            pages: facts,
            palette: [draft.document.colors.background, draft.document.colors.primary, draft.document.colors.accent],
            fonts: draft.fonts,
            topics: taxonomy,
          }),
          schemaName: DESIGN_CLASSIFIER_NAME,
          schema: DESIGN_CLASSIFIER_SCHEMA,
          maxOutputTokens: 1200,
          attempts: 2,
        }),
      ]);

      if (slides.status === "fulfilled") slideAnswer = slides.value.data;
      else warnings.push("Sahifa rollari avtomatik aniqlandi — model javob bermadi.");
      if (subjects.status === "fulfilled") topicAnswer = subjects.value.data;
      else warnings.push("Dizayn mavzulari aniqlanmadi — keyinroq qo‘lda qo‘shish mumkin.");
    } else {
      warnings.push("GEMINI_API_KEY sozlanmagan — rollar tuzilishga qarab aniqlandi.");
    }

    // Both readers fall back to the deterministic guess, so these are complete
    // whether or not the two calls above happened at all.
    const profiles = readSlideProfiles(slideAnswer, draft.pages);
    const keywords = readDesignKeywords(topicAnswer, allowed);

    const summary = {
      name,
      slides: deck.slides.length,
      pages: draft.pages.map((page, index) => ({
        archetypeId: page.archetype.id,
        sourceIndex: page.sourceIndexInFile,
        purpose: page.purpose,
        role: profiles[index]!.role,
        recommendedStoryPosition: profiles[index]!.recommendedStoryPosition,
        textSlots: page.textSlots,
        imageSlots: page.imageSlots,
        artwork: page.artwork.length,
      })),
      fonts: draft.fonts,
      keywords,
      warnings,
      colors: draft.document.colors,
    };

    if (body.step !== "import") return json({ ok: true, code: "inspected", ...summary });

    /* -------------------------------------------------------------- writing */

    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug) || slug.length < 3) {
      throw new HttpError(400, "Slug noto‘g‘ri: faqat kichik harflar, raqamlar va tire.", "bad_slug");
    }

    const designId = await context.userClient.rpc("admin_save_design", {
      p_slug: slug,
      p_name: name,
      p_tier: tier,
      p_description: draft.document.design.description,
      p_is_premium: body.premium ?? false,
      // A template has no prompt behind it. Saying so is more useful than an
      // empty string that looks like an author's work went missing.
      p_source_prompt: `PowerPoint shablonidan import qilindi: ${body.originalName ?? storagePath}`,
      p_compiled_config: draft.document as never,
      p_preview: renderPreview(draft.document) as never,
      p_content_hash: await contentHash(draft.document),
    });
    if (designId.error) throw designId.error;
    const id = designId.data as string;

    const service = context.serviceClient;

    // The notation and the subjects, neither of which the shared save RPC knows
    // about — it predates a design having more than one possible source.
    const marked = await service.from("presentation_designs")
      // Stored as the column documents them: `{keyword, score}`, the keyword
      // being a `design_topics` slug so a selector joins rather than matches
      // spelling.
      .update({
        design_source: "pptx",
        keywords: keywords.map((topic) => ({ keyword: topic.slug, score: topic.score })),
      })
      .eq("id", id);
    if (marked.error) throw marked.error;

    const stored = await service.from("design_slide_profiles").upsert(
      profiles.map((profile) => ({
        design_id: id,
        design_version: 1,
        archetype_id: profile.archetypeId,
        source_index: profile.sourceIndex,
        role: profile.role,
        recommended_story_position: profile.recommendedStoryPosition,
        alternative_roles: profile.alternativeRoles,
        density: profile.density,
        text_capacity: profile.textCapacity,
        visual_weight: profile.visualWeight,
        layout_signature: profile.layoutSignature,
        supports_image: profile.supportsImage,
        supports_chart: profile.supportsChart,
        supports_table: profile.supportsTable,
        supports_quote: profile.supportsQuote,
        supports_stats: profile.supportsStats,
        is_terminal: profile.isTerminal,
      })),
      { onConflict: "design_id,design_version,archetype_id" },
    );
    if (stored.error) throw stored.error;

    const recorded = await service.from("design_source_assets").insert({
      design_id: id,
      source: "pptx",
      content_hash: hash,
      storage_path: storagePath,
      original_filename: (body.originalName ?? "").slice(0, 200),
      slide_count: deck.slides.length,
      text_node_count: draft.pages.reduce((sum, page) => sum + page.textSlots, 0),
      image_count: draft.pages.reduce((sum, page) => sum + page.imageSlots + page.artwork.length, 0),
      byte_size: bytes.byteLength,
      uploaded_by: context.user.id,
    });
    if (recorded.error) throw recorded.error;

    /**
     * The typefaces, put on a shelf rather than in the design.
     *
     * Ten designs using Inter used to store it ten times and an eleventh could
     * not discover it was already there. A family row is created once and every
     * design that wants it points at the same one; `resolved` stays false until
     * a face is actually uploaded, which is what tells an admin the design is
     * still drawing in its fallback.
     */
    for (const requested of draft.fonts) {
      const normalized = requested.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!normalized) continue;
      const family = await service.from("font_families")
        .upsert({ canonical_name: requested, normalized_name: normalized, source: "pptx" },
          { onConflict: "normalized_name" })
        .select("id")
        .single();
      if (family.error) { warnings.push(`"${requested}" shrifti ro‘yxatga olinmadi.`); continue; }

      const faces = await service.from("font_faces").select("id").eq("family_id", family.data.id).limit(1);
      await service.from("design_font_usage").upsert({
        design_id: id,
        family_id: family.data.id,
        requested_name: requested,
        resolved: (faces.data ?? []).length > 0,
      }, { onConflict: "design_id,family_id" });
    }

    return json({ ok: true, code: "imported", designId: id, ...summary, warnings });
  } catch (error) {
    if (error instanceof ProviderUnavailable) {
      // Never the provider's own sentence: those carry billing and account
      // detail that is nobody's business but ours.
      return errorResponse(new HttpError(503, "Matn modeli hozir javob bermayapti.", "provider_unavailable"));
    }
    return errorResponse(error);
  }
});
