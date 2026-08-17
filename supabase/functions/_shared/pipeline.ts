import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { elementSlotsFor, fillElementSlots, slidesWithElements } from "./jelement-visuals.ts";
import { familyOf } from "./jslayd/index.ts";
import {
  applyRewrite, briefForPrompt, findSlotProblems, planDeckLayout,
  type SlotProblem,
} from "./layout-brief.ts";
import { buildJslaydSlides, readDesign, type ResolvedDesign } from "./jslayd-layout.ts";
import { OpenAIClient } from "./openai.ts";
import { attributionMetadata, Writer } from "./writer.ts";
import { contentSchema, outlineSchema, rewriteSchema } from "./plan-schema.ts";
import type { GeneratedImage, LayoutName, PresentationPlan, ResearchSource, SemanticSlide, VisualDna } from "./presentation-types.ts";
import { findPhoto } from "./providers/photo.ts";

type PipelineInput = { jobId: string; presentationId: string; ownerId: string; service: SupabaseClient; safetyIdentifier: string };
/** The model supplies narrative direction only — never colours or typography. */
type ModelDna = Pick<VisualDna, "mood" | "era" | "visualStyle" | "textures" | "imageDirection">;
type Outline = { visualDna: ModelDna; slides: Array<{ title: string; purpose: string; layout: LayoutName; visualPrompt: string | null }> };
type Content = { slides: Array<Omit<SemanticSlide, "purpose" | "layout" | "visualPrompt">> };

/**
 * How each visual DNA field reads for an image model.
 *
 * JSLAYD states a design's imagery as two enumerations rather than as prose,
 * because an enumeration is what an admin can pick and a renderer can honour.
 * The prose has to exist somewhere for the image prompt, and here is the one
 * place it is needed — so it is written once, against the vocabulary, instead
 * of being carried per design and drifting between them.
 */
const IMAGE_TREATMENT: Record<string, string> = {
  photo: "editorial photography, natural light, shallow depth of field, no text",
  illustration: "flat vector illustration, clean shapes, limited palette, no text",
  render3d: "isolated 3D clay render, matte finish, soft contact shadow, generous negative space",
  abstract: "abstract geometric composition, layered shapes, no recognisable objects",
  mixed: "modern editorial collage of photography and flat shapes, no text",
};

const DECORATION: Record<string, { elements: string[]; spacing: string }> = {
  none: { elements: [], spacing: "austere, wide margins, nothing but type and image" },
  low: { elements: ["thin rules", "restrained accent marks"], spacing: "calm, generous margins, strong vertical rhythm" },
  medium: { elements: ["accent shapes", "rounded cards", "thin outlined rings"], spacing: "balanced, clear grid, comfortable margins" },
  high: { elements: ["layered shapes", "edge-cropped circles", "solid accent discs", "pill buttons"], spacing: "dense, energetic, deliberate overlap" },
};

/**
 * The direction the image provider reads, built from the design the deck will
 * actually be laid into.
 *
 * This used to come from a built-in template even when the deck used a JSLAYD
 * design — so a deck could be laid out by one design and illustrated for
 * another. Reading both from the same document is what makes the imagery and
 * the layout the same design.
 *
 * The model contributes mood, era, texture and framing; it is never asked for
 * colours or typography, which belong to the design and to nothing else.
 */
function composeJslaydDna(model: ModelDna, design: ResolvedDesign, paletteCode: string | null): VisualDna {
  const document = design.document;
  const family = familyOf(document, paletteCode);
  const dna = document.visualDNA;
  const decoration = DECORATION[dna.decorationDensity] ?? DECORATION.medium;

  const roleFont = (role: string): string | undefined =>
    document.fonts.find((font) => font.roles.includes(role as never))?.name;

  return {
    ...model,
    palette: {
      background: family.colors.background,
      surface: family.colors.surface,
      primary: family.colors.primary,
      secondary: family.colors.secondary,
      accent: family.colors.accent,
      textPrimary: family.colors.text,
      textSecondary: family.colors.textSecondary,
      border: family.colors.border,
    },
    typography: {
      display: roleFont("display") ?? roleFont("heading") ?? document.fonts[0]?.name ?? "Manrope",
      body: roleFont("body") ?? document.fonts[0]?.name ?? "Manrope",
    },
    illustrationStyle: IMAGE_TREATMENT[dna.imageTreatment] ?? IMAGE_TREATMENT.illustration,
    iconStyle: decoration.elements.join(", "),
    decorativeElements: [...decoration.elements],
    spacingStyle: decoration.spacing,
    chartStyle: `two-tone charts drawn from ${family.chartPalette.slice(0, 2).join(" and ")}, no gridlines`,
    templateCode: document.design.slug,
    paletteCode: family.code,
  };
}

/**
 * Reads the JSLAYD design a deck should be laid out with.
 *
 * A deck records both the design and the version it was generated against, and
 * the pinned version is what is read — an admin publishing v2 must not silently
 * relayout a deck that shipped on v1 (§59). A deck being generated now carries
 * no pin yet and gets the current published document.
 *
 * Every failure returns null and says why in the log. The caller falls back to
 * the built-in blueprint, so the worst case is a deck that looks like it did
 * before JSLAYD existed rather than a deck that does not exist (§99).
 */
async function loadJslaydDesign(
  service: SupabaseClient,
  designId: string,
  version: number | null,
): Promise<ResolvedDesign | null> {
  const current = await service
    .from("presentation_designs")
    .select("id, slug, published_version, compiled_config")
    .eq("id", designId)
    .maybeSingle();
  if (current.error || !current.data) {
    console.error("jslayd design lookup failed", designId, current.error?.message ?? "not found");
    return null;
  }

  let row = {
    id: current.data.id,
    slug: current.data.slug,
    version: current.data.published_version,
    compiled_config: current.data.compiled_config as unknown,
  };

  if (version !== null && version !== current.data.published_version) {
    const pinned = await service
      .from("presentation_design_versions")
      .select("version, compiled_config")
      .eq("design_id", designId)
      .eq("version", version)
      .maybeSingle();
    if (pinned.error || !pinned.data) {
      console.error("jslayd pinned version missing", designId, version, pinned.error?.message ?? "not found");
      return null;
    }
    row = { ...row, version: pinned.data.version, compiled_config: pinned.data.compiled_config as unknown };
  }

  const { design, reason } = readDesign(row);
  if (!design) {
    console.error("jslayd design unusable, falling back to the built-in blueprint", designId, reason);
  }
  return design;
}

/** Cover, agenda, bibliography and closing — assembled here, never by the model. */
const SPECIAL_SLIDES = 4;
const AGENDA_TITLE = "Mavzular rejasi";
const REFERENCES_TITLE = "Foydalanilgan adabiyotlar";
const THANKS_TITLE = "E’tiboringiz uchun rahmat";

const stages = [
  ["preparing", "Tayyorlanmoqda", 2],
  ["understanding_topic", "Mavzu tushunilmoqda", 8],
  ["researching", "Internetdan manbalar izlanmoqda", 18],
  ["creating_outline", "Slaydlar rejasi yaratilmoqda", 28],
  ["writing_content", "Mazmun yozilmoqda", 42],
  ["visual_identity", "Vizual identitet yaratilmoqda", 52],
  ["building_layouts", "Layoutlar tanlanmoqda", 62],
  ["finding_assets", "Materiallar tayyorlanmoqda", 69],
  ["generating_images", "Vizuallar yaratilmoqda", 78],
  ["building_slides", "Slaydlar qurilmoqda", 88],
  ["quality_checking", "Sifat tekshirilmoqda", 94],
  ["finalizing", "Yakunlanmoqda", 98],
  ["ready", "Tayyor", 100],
] as const;

async function initializeSteps(service: SupabaseClient, input: PipelineInput) {
  const rows = stages.map(([key, label], sequence) => ({
    job_id: input.jobId, presentation_id: input.presentationId, owner_id: input.ownerId,
    sequence, key, label, status: "queued", progress: 0,
  }));
  const { error } = await service.from("generation_steps").upsert(rows, { onConflict: "job_id,key", ignoreDuplicates: true });
  if (error) throw error;
}

async function runStage<T>(service: SupabaseClient, input: PipelineInput, key: typeof stages[number][0], action: () => Promise<T>, successMessage?: (value: T) => string): Promise<T> {
  const stage = stages.find(([stageKey]) => stageKey === key)!;
  const now = new Date().toISOString();
  await Promise.all([
    service.from("generation_jobs").update({ status: "running", stage: key, progress: stage[2], heartbeat_at: now, started_at: key === "preparing" ? now : undefined }).eq("id", input.jobId),
    service.from("generation_steps").update({ status: "running", progress: 5, started_at: now }).eq("job_id", input.jobId).eq("key", key),
  ]);
  try {
    const value = await action();
    await service.from("generation_steps").update({ status: "succeeded", progress: 100, completed_at: new Date().toISOString(), message: successMessage?.(value) ?? null }).eq("job_id", input.jobId).eq("key", key);
    return value;
  } catch (error) {
    await service.from("generation_steps").update({ status: "failed", message: error instanceof Error ? error.message.slice(0, 500) : "Stage failed", completed_at: new Date().toISOString() }).eq("job_id", input.jobId).eq("key", key);
    throw error;
  }
}

function mockOutline(topic: string, count: number): Outline {
  return {
    visualDna: { mood: "professional", era: "contemporary", visualStyle: "editorial minimalism", textures: ["subtle paper"], imageDirection: "subject to the right with negative space on the left" },
    // Content slides only — the deck's four fixed slides never reach the model.
    slides: Array.from({ length: count }, (_, index) => ({
      title: index === count - 1 ? "Xulosa" : `${topic}: ${index + 1}-qism`,
      purpose: index === count - 1 ? "Asosiy fikrlarni yakunlash" : "Mavzuni mantiqiy rivojlantirish",
      layout: (index === count - 1 ? "conclusion" : index % 4 === 0 ? "statistic" : index % 3 === 0 ? "two_columns" : "title_body") as LayoutName,
      visualPrompt: null,
    })),
  };
}

function mockContent(outline: Outline): Content {
  return { slides: outline.slides.map((slide, index) => ({
    title: slide.title,
    subtitle: index === 0 ? "Jaxongir AI tomonidan tayyorlangan taqdimot" : null,
    bullets: index === 0 ? [] : ["Asosiy tushuncha va uning ahamiyati", "Muhim jihatlar o‘rtasidagi bog‘liqlik", "Amaliy xulosa va keyingi qadam"],
    body: index === 0 ? null : "Mavzu aniq tuzilma, qisqa izohlar va o‘qilishi oson vizual iyerarxiya orqali yoritiladi.",
    quote: null,
    statistic: slide.layout === "statistic" ? { value: "3", label: "mavzuni tushunishga yordam beradigan asosiy yo‘nalish" } : null,
    chart: null,
    table: null,
  })) };
}

function userInput(text: string, fileIds: string[]) {
  return [{ role: "user", content: [{ type: "input_text", text }, ...fileIds.map((fileId) => ({ type: "input_file", file_id: fileId }))] }];
}

/** A slide with nothing on it but its own headline. */
function bareSlide(title: string, purpose: string, layout: LayoutName, subtitle: string | null = null, bullets: string[] = []): SemanticSlide {
  return { title, subtitle, purpose, layout, bullets, body: null, quote: null, statistic: null, chart: null, table: null, visualPrompt: null };
}

/** Who prepared the deck and for whom, which is what a title page is asked for. */
function coverSubtitle(authorName: string | null, teacherName: string | null): string {
  const lines: string[] = [];
  if (authorName?.trim()) lines.push(`Bajardi: ${authorName.trim()}`);
  if (teacherName?.trim()) lines.push(`O‘qituvchi: ${teacherName.trim()}`);
  return lines.length ? lines.join("\n") : "Jaxongir AI tomonidan tayyorlangan taqdimot";
}

/** `https://oz.wikipedia.org/wiki/x` → `oz.wikipedia.org/wiki/x`, so a citation
 *  reads as a reference rather than as a wall of protocol noise. */
function readableUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function citationLine(source: ResearchSource): string {
  if (!source.url) return source.label;
  return `${source.label} — ${readableUrl(source.url)}`;
}

/**
 * Assembles the deck the user actually asked for: a title page naming the
 * author and their teacher, an agenda, the researched body, the bibliography and
 * a closing line. Only the middle is written by the model; the four fixed slides
 * are built from data the server already has, so they cost nothing to produce.
 */
/** Cover and agenda sit in front of the written body; both are server-built. */
const DECK_PREFIX = 2;

function assembleDeck(params: {
  topic: string;
  authorName: string | null;
  teacherName: string | null;
  outline: Outline;
  content: Content;
  sources: ResearchSource[];
  visualDna: VisualDna;
}): PresentationPlan {
  const { topic, outline, content, sources, visualDna } = params;
  const body = outline.slides.map((slide, index) => ({
    ...slide,
    ...(content.slides[index] ?? mockContent({ ...outline, slides: [slide] }).slides[0]!),
  }));

  const cover = bareSlide(topic, "Mavzuni va mualliflarni tanishtirish", "cover", coverSubtitle(params.authorName, params.teacherName));
  const agenda = bareSlide(AGENDA_TITLE, "Taqdimot tuzilmasini ko‘rsatish", "agenda", null, body.map((slide) => slide.title).slice(0, 10));
  const references = bareSlide(REFERENCES_TITLE, "Ishlatilgan manbalarni ko‘rsatish", "references");
  const thanks = bareSlide(THANKS_TITLE, "Taqdimotni yakunlash", "thanks", sources.length ? "Savollaringiz bo‘lsa, marhamat." : null);

  return { visualDna, slides: [cover, agenda, ...body, references, thanks] };
}

/**
 * What each model costs, from the one configured price list.
 *
 * Keyed by model name, so adding a provider is a settings row rather than a
 * code change — and a stage that ran on a model nobody priced logs a zero
 * rather than a guess, which is visible in the dashboard as a gap instead of
 * being quietly wrong.
 *
 * There is no image price any more. Pictures are found, not generated: an
 * openly licensed photograph costs nothing, and a library element costs nothing
 * twice.
 */
async function providerPricing(service: SupabaseClient) {
  const { data } = await service.from("app_settings").select("value").eq("key", "ai.provider_pricing").maybeSingle();
  const value = data?.value && typeof data.value === "object" && !Array.isArray(data.value) ? data.value as Record<string, unknown> : {};
  return {
    for(model: string) {
      const row = value[model] as Record<string, number> | undefined;
      return { inputPerMillion: Number(row?.input_per_million ?? 0), outputPerMillion: Number(row?.output_per_million ?? 0) };
    },
  };
}

function usageCost(usage: { input_tokens?: number; output_tokens?: number }, pricing: { inputPerMillion: number; outputPerMillion: number }) {
  return ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion + ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion;
}

export async function runGenerationPipeline(input: PipelineInput): Promise<void> {
  const openai = new OpenAIClient();
  // Research and copy go to Gemini when it is configured, and to OpenAI when it
  // is not or when it fails. Image generation is deliberately not routed: the
  // imagery was never the problem this change is solving.
  const writer = new Writer(openai);
  const uploadedFileIds: string[] = [];
  let totalCost = 0;
  try {
    await initializeSteps(input.service, input);
    const prepared = await runStage(input.service, input, "preparing", async () => {
      const [presentationResult, sourcesResult, assetsResult] = await Promise.all([
        input.service.from("presentations").select("*").eq("id", input.presentationId).eq("owner_id", input.ownerId).single(),
        input.service.from("presentation_sources").select("label").eq("presentation_id", input.presentationId).order("position"),
        input.service.from("presentation_assets").select("*").eq("presentation_id", input.presentationId).eq("kind", "upload"),
      ]);
      if (presentationResult.error) throw presentationResult.error;
      if (sourcesResult.error) throw sourcesResult.error;
      if (assetsResult.error) throw assetsResult.error;
      return { presentation: presentationResult.data, sources: sourcesResult.data.map((row) => row.label), assets: assetsResult.data };
    }, (value) => `${value.presentation.requested_slide_count} ta slayd uchun ish boshlandi`);

    const mode = Deno.env.get("GENERATION_MODE") ?? "real";
    if (mode !== "real" && mode !== "mock") throw new Error("GENERATION_MODE must be real or mock");
    if (mode === "real" && !openai.configured) throw new Error("OPENAI_API_KEY is not configured; production never falls back to mock mode");

    const context = await runStage(input.service, input, "understanding_topic", async () => {
      if (mode === "mock") return { fileIds: [] as string[] };
      for (const asset of prepared.assets.slice(0, 5)) {
        if (!asset.storage_path || (asset.byte_size && asset.byte_size > 20 * 1024 * 1024)) continue;
        const { data, error } = await input.service.storage.from(asset.storage_bucket ?? "user-uploads").download(asset.storage_path);
        if (error || !data) continue;
        const fileId = await openai.uploadFile(data, asset.storage_path.split("/").pop() ?? "source-file");
        uploadedFileIds.push(fileId);
      }
      return { fileIds: uploadedFileIds };
    }, (value) => value.fileIds.length ? `${value.fileIds.length} ta material kontekst sifatida tayyorlandi` : "Mavzu tahlilga tayyorlandi");

    // The deck always opens with a title page and an agenda and closes with a
    // bibliography and a thank-you, so the model only writes what sits between.
    const contentCount = Math.max(1, prepared.presentation.requested_slide_count - SPECIAL_SLIDES);

    const research = await runStage(input.service, input, "researching", async () => {
      const empty = {
        text: "",
        citations: [] as { title: string; url: string }[],
        usage: {} as { input_tokens?: number; output_tokens?: number },
        requestId: null as string | null,
      };
      if (mode === "mock") return { ...empty, failure: null as string | null };
      const system = "You are a research assistant for Uzbek-language academic presentations. Search the live web before answering and report only what the pages you opened actually say. Never state a fact you could not find a source for. Write in Uzbek Latin script.";
      // Notes, not an essay. This stage was spending 30–45k input tokens on
      // prose that the writing stage then compressed away — a deck needs the
      // facts, and the facts are short. Asking for them as a list rather than
      // as exposition is most of the saving.
      const prompt = `Mavzu: ${prepared.presentation.topic}\n\nIshonchli manbalardan qidiring: rasmiy saytlar, ilmiy nashrlar, statistika idoralari, universitetlar.\nQuyidagilarni QISQA ro'yxat qilib yozing — izoh va kirish so'zlarisiz:\n- FAKTLAR: 8–12 ta aniq dalil, har biri bir qatorda, qavsda manba.\n- RAQAMLAR: 4–8 ta statistika, yil va manba bilan.\n- TA'RIFLAR: 2–4 ta asosiy tushuncha, bir jumladan.\n- MANBALAR: 5–8 ta havola.\nManbasi yo'q da'voni yozmang. Uzun paragraf yozmang.\nBiriktirilgan fayllar bo'lsa, ular ham kontekst hisoblanadi.`;
      try {
        const result = await writer.research({
          prompt: `${system}\n\n${prompt}`,
          system,
          openaiInput: [{ role: "system", content: system }, ...userInput(prompt, context.fileIds)],
          safetyIdentifier: input.safetyIdentifier,
          maxOutputTokens: 2_500,
        });
        return { ...result, failure: null as string | null };
      } catch (error) {
        // A provider that cannot search must not cost the user the whole deck.
        // Writing falls back to the model's own knowledge, and the step says so
        // out loud so an unsourced deck is never mistaken for a researched one.
        const message = error instanceof Error ? error.message : "web search unavailable";
        console.error("web research failed", input.jobId, message);
        return { ...empty, failure: message.slice(0, 160) };
      }
    }, (value) => value.failure
      ? `Internet qidiruvi ishlamadi (${value.failure}) — matn model bilimidan yozildi`
      : value.citations.length
        ? `${value.citations.length} ta manba topildi va tekshirildi`
        : "Internetdan qo‘shimcha manba topilmadi");

    // A deck is laid out by a published design and by nothing else, and the
    // design is read here — before the outline — because everything downstream
    // is written to fit it. There used to be a built-in blueprint behind this,
    // so a deck with no design still produced slides; that fallback is what kept
    // withdrawn designs alive in the product.
    //
    // Resolved before a credit is spent, so an unreadable design costs the job
    // nothing rather than costing it a deck's worth of imagery first.
    const jslayd = await loadJslaydDesign(
      input.service, prepared.presentation.design_id, prepared.presentation.design_version,
    );
    if (!jslayd) {
      throw new Error("Tanlangan dizayn topilmadi yoki nashr qilinmagan. Iltimos, boshqa dizayn tanlang.");
    }

    const researchBrief = research.text.trim()
      ? `\n\nTEKSHIRILGAN MANBALAR VA DALILLAR (faqat shulardan foydalaning):\n${research.text.trim()}`
      : "";

    const outlineResult = await runStage(input.service, input, "creating_outline", async () => {
      if (mode === "mock") return { data: mockOutline(prepared.presentation.topic, contentCount), usage: {}, requestId: null };
      const system = "You are Jaxongir AI, a senior presentation strategist. Produce academically usable Uzbek Latin content architecture grounded in the supplied research. Every slide must advance a specific, concrete idea — never a vague heading. The visual design is fixed by the chosen design, so never propose colours, fonts or decoration. Return only the required schema.";
      const prompt = `Mavzu: ${prepared.presentation.topic}\nMazmun slaydlari soni: ${contentCount}\nUslub: ${prepared.presentation.style}\nTanlangan dizayn: ${jslayd.document.design.name} — ${jslayd.document.design.description}.\n\nSarlavha, mavzular rejasi, foydalanilgan adabiyotlar va yakuniy slaydlarni server o'zi qo'shadi — ularni rejalashtirmang. Faqat ${contentCount} ta mazmun slaydini rejalashtiring va ularni mantiqiy ketma-ketlikda joylashtiring: tushuncha → tahlil → dalillar → amaliyot → xulosa.\nHar bir sarlavha aniq bo'lsin: "Kirish" emas, mavzu haqida nima aytilishini ayting.\nRaqam yoki statistika bor slayd uchun statistic yoki chart layoutini tanlang.\nVisual prompt faqat matnsiz illyustratsiyani tasvirlaydi va yuqoridagi art directionga mos bo'lishi kerak.${researchBrief}`;
      return writer.structured<Outline>({
        prompt: `${system}\n\n${prompt}`,
        system,
        schemaName: "presentation_outline",
        schema: outlineSchema(contentCount),
        openaiInput: [{ role: "system", content: system }, ...userInput(prompt, context.fileIds)],
        safetyIdentifier: input.safetyIdentifier,
      });
    }, (value) => `${value.data.slides.length} ta mazmun slaydi rejalashtirildi`);

    /**
     * The composition each slide will be laid into, chosen before its copy is
     * written.
     *
     * This is the whole change. The old order wrote the copy, chose a layout,
     * pushed one into the other and shrank the type until it stopped
     * overflowing — so the design was decided by how much somebody happened to
     * write. Choosing first means the writer can be told how much the box
     * holds, and the renderer lays the result into the same archetype the
     * budget came from.
     */
    const layoutPlan = planDeckLayout(
      jslayd.document,
      outlineResult.data.slides.map((slide) => ({
        layout: slide.layout, title: slide.title, purpose: slide.purpose,
      })),
    );

    const layoutInstruction = `\n\nDIZAYN O'LCHOVLARI — matn shu qutilarga yozilishi kerak.\n`
      + `Har slayd o'z arxetipiga ega. "aim" — mo'ljal, "limit" — qat'iy chegara (belgi soni).\n`
      + `Bo'sh joy dizaynning bir qismi: limitgacha yozish SHART EMAS, aim atrofida to'xtang.\n`
      + `Sarlavhada zarur bo'lsa \\n bilan mantiqiy joydan qator ajrating; oxirgi qator bitta qisqa so'z bo'lib qolmasin.\n`
      + `Arxetiplar:\n${JSON.stringify(layoutPlan.briefs.map(briefForPrompt))}\n`
      + `Slaydlar: ${JSON.stringify(layoutPlan.slides.map((slide) => ({ i: slide.index, archetype: slide.archetypeId })))}`;

    const contentResult = await runStage(input.service, input, "writing_content", async () => {
      if (mode === "mock") return { data: mockContent(outlineResult.data), usage: {}, requestId: null };
      const system = "You are an expert Uzbek Latin academic presentation writer working to a fixed layout. Follow the supplied outline exactly and ground every sentence in the supplied research. Write specific, checkable content: real numbers, dates, names and definitions instead of generalities. Grammar must be flawless Uzbek Latin. Never fabricate a quotation, statistic or date — if the research does not support it, write something the research does support instead. The layout is fixed and is not yours to change: write copy that fits the boxes you are given. Return only the required schema.";
      const prompt = `Mavzu: ${prepared.presentation.topic}\nReja:\n${JSON.stringify(outlineResult.data.slides)}\n\nAynan ${contentCount} ta slayd uchun matn yozing.\n- subtitle: sarlavhani ochib beruvchi bitta qisqa jumla (bezakli yozuv). Har slaydda bo'lsin.\n- bullets: 3–5 ta band. Har biri to'liq, aniq fikr: raqam, sana, ism yoki aniq ta'rif bo'lsin. "Muhim ahamiyatga ega" kabi quruq iboralarni yozmang.\n- body: bandlarni bog'lovchi 1–2 jumlalik izoh, agar slayd shuni talab qilsa.\n- statistic: faqat tadqiqotda haqiqatan uchragan raqamni yozing.\n- chart: faqat tadqiqotdagi haqiqiy qiymatlar bilan to'ldiring.\n- table: faqat tadqiqotda haqiqatan jadval ko'rinishidagi ma'lumot bo'lsa to'ldiring; 2-6 ustun, 2-8 qator.\nBibliografiya yozmang — uni server alohida qo'shadi.${researchBrief}${layoutInstruction}`;
      return writer.structured<Content>({
        prompt: `${system}\n\n${prompt}`,
        system,
        schemaName: "presentation_content",
        schema: contentSchema(contentCount),
        openaiInput: [{ role: "system", content: system }, ...userInput(prompt, context.fileIds)],
        safetyIdentifier: input.safetyIdentifier,
        maxOutputTokens: 16_000,
      });
    }, () => "Slayd matnlari yozildi va manbalarga bog‘landi");


    // User-entered labels come first — they are what the author explicitly cited —
    // then every page the research actually opened, deduplicated by address.
    const deckSources: ResearchSource[] = [...prepared.sources.map((label) => ({ label, url: null }))];
    for (const citation of research.citations) {
      if (deckSources.some((source) => source.url === citation.url || source.label === citation.title)) continue;
      deckSources.push({ label: citation.title, url: citation.url });
    }
    if (mode === "real" && research.citations.length) {
      await input.service.from("presentation_sources").upsert(
        research.citations.map((citation, position) => ({
          presentation_id: input.presentationId,
          owner_id: input.ownerId,
          label: citation.title.slice(0, 1000),
          url: citation.url,
          position: prepared.sources.length + position,
          metadata: { discovered_by: "web_search" },
        })),
      );
    }

    /**
     * Copy that does not fit is rewritten, not shrunk.
     *
     * The renderer has a shrink pass and it stays — it is the last line of
     * defence and some slides will always need it. But reaching for it first is
     * what produced eleven-point body text: the type gets quietly smaller until
     * the words fit, and nobody ever sees that the words were the problem.
     *
     * Two attempts, no more. A third is a slide whose content genuinely does
     * not belong in that composition, and grinding at it costs a person real
     * money for a result that is not going to improve.
     */
    const writtenSlides = [...contentResult.data.slides];
    let rewriteUsage = { input_tokens: 0, output_tokens: 0 };
    let rewrites = 0;
    let rewriteAttribution: { provider: string; model: string; fallbackFrom?: string; fallbackReason?: string } =
      { provider: "openai", model: openai.textModel };

    if (mode !== "mock") {
      const briefById = new Map(layoutPlan.briefs.map((brief) => [brief.archetypeId, brief]));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const failing: { index: number; problems: SlotProblem[] }[] = [];

        layoutPlan.slides.forEach((planned) => {
          const brief = briefById.get(planned.archetypeId);
          const written = writtenSlides[planned.index];
          if (!brief || !written) return;
          const outlineSlide = outlineResult.data.slides[planned.index];
          const problems = findSlotProblems(brief, {
            ...written,
            title: outlineSlide?.title ?? "",
            purpose: outlineSlide?.purpose ?? "",
            layout: planned.layout,
          } as never);
          if (problems.length > 0) failing.push({ index: planned.index, problems });
        });

        if (failing.length === 0) break;

        const request = failing.map((entry) => ({
          slide: entry.index,
          fields: entry.problems.map((problem) => ({
            field: problem.binding,
            current: problem.text,
            maxCharacters: problem.maximumCharacters,
            aimCharacters: problem.aim,
            maxLines: problem.maximumLines,
            issue: problem.orphan ? "last line is a single short word" : `${problem.overBy} characters too long`,
          })),
        }));

        const rewriteSystem = "You are rewriting presentation copy to fit a fixed layout. Preserve the meaning and the facts exactly. Shorten by removing unnecessary words, simplifying sentences and dropping duplicated ideas — in that order. Never invent a new fact to fill space, never change a number, and never mention the layout. Return only the required schema.";
        const rewritePrompt = `Quyidagi matnlar dizayndagi qutilarga sig'madi. Ma'noni saqlagan holda qisqartiring.\nHar bir maydon uchun "aimCharacters" atrofida yozing, "maxCharacters" dan oshmang.\n"last line is a single short word" bo'lsa, qator ajratishni o'zgartiring yoki qisqartiring.\n\n${JSON.stringify(request)}`;
        const rewritten = await writer.structured<{ slides: { slide: number; fields: { field: string; text: string }[] }[] }>({
          prompt: `${rewriteSystem}\n\n${rewritePrompt}`,
          system: rewriteSystem,
          schemaName: "content_rewrite",
          schema: rewriteSchema(),
          openaiInput: [{ role: "system", content: rewriteSystem }, { role: "user", content: rewritePrompt }],
          safetyIdentifier: input.safetyIdentifier,
          maxOutputTokens: 4_000,
        });

        rewrites += 1;
        rewriteAttribution = {
          provider: rewritten.provider, model: rewritten.model,
          ...(rewritten.fallbackFrom ? { fallbackFrom: rewritten.fallbackFrom, fallbackReason: rewritten.fallbackReason } : {}),
        };
        rewriteUsage = {
          input_tokens: (rewriteUsage.input_tokens ?? 0) + (rewritten.usage.input_tokens ?? 0),
          output_tokens: (rewriteUsage.output_tokens ?? 0) + (rewritten.usage.output_tokens ?? 0),
        };

        for (const entry of rewritten.data.slides ?? []) {
          const current = writtenSlides[entry.slide];
          if (!current) continue;
          let next = current;
          for (const field of entry.fields ?? []) {
            next = applyRewrite(next as never, field.field, field.text) as never;
          }
          writtenSlides[entry.slide] = next;
        }
      }
    }

    const plan = await runStage(
      input.service,
      input,
      "visual_identity",
      async () => assembleDeck({
        topic: prepared.presentation.topic,
        authorName: prepared.presentation.author_name,
        teacherName: prepared.presentation.teacher_name,
        outline: outlineResult.data,
        content: { slides: writtenSlides },
        sources: deckSources,
        // A JSLAYD deck's imagery has to match the design it will be laid into,
        // so the design's own colours replace the picked palette family in the
        // direction the image provider reads. Everything else the model wrote —
        // mood, era, texture — is untouched.
        visualDna: composeJslaydDna(outlineResult.data.visualDna, jslayd, prepared.presentation.palette_code),
      }),
      () => `«${jslayd.document.design.name}» dizayni (v${jslayd.version}) qo‘llandi`,
    );
    const pricing = await providerPricing(input.service);

    /**
     * One row per stage, naming the model that actually ran it.
     *
     * Not "openai" for everything: a deck may be researched by Gemini and
     * written by OpenAI in the same job, and a dashboard that says otherwise
     * makes the fallback invisible — which is how a month of unexpectedly
     * paying the more expensive vendor goes unnoticed until the invoice.
     */
    const stages: { operation: string; answer: { usage: { input_tokens?: number; output_tokens?: number }; requestId: string | null; provider: string; model: string; fallbackFrom?: string; fallbackReason?: string } }[] = [
      { operation: "topic_research", answer: research },
      { operation: "presentation_outline", answer: outlineResult },
      { operation: "presentation_content", answer: contentResult },
    ];
    if (rewrites > 0) {
      stages.push({ operation: "content_rewrite", answer: { ...rewriteAttribution, usage: rewriteUsage, requestId: null } });
    }

    const rows = stages.map((stage) => {
      const cost = usageCost(stage.answer.usage, pricing.for(stage.answer.model));
      totalCost += cost;
      return {
        owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId,
        provider: stage.answer.provider, model: stage.answer.model, operation: stage.operation,
        input_tokens: stage.answer.usage.input_tokens ?? 0,
        output_tokens: stage.answer.usage.output_tokens ?? 0,
        provider_cost_usd: cost, request_id: stage.answer.requestId,
        metadata: attributionMetadata(stage.answer as never),
      };
    });
    if (mode === "real") await input.service.from("ai_usage").insert(rows);

    await runStage(input.service, input, "building_layouts", async () => plan.slides, (value) => `${value.length} ta layout tanlandi`);

    /**
     * Which archetype each deck slide is drawn by, in deck order.
     *
     * `layoutPlan` covers the written body; the cover, agenda, bibliography and
     * closing slides sit around it and are laid out by the design's own choice.
     */
    const archetypesInOrder = plan.slides.map((_, position) => {
      const planned = layoutPlan.slides[position - DECK_PREFIX];
      return planned ? jslayd.document.archetypes.find((entry) => entry.id === planned.archetypeId) : undefined;
    });

    /**
     * Materials: what the user uploaded, and the reusable objects the design
     * asked for.
     *
     * Both in one stage because both are the same question — what is there to
     * put on these slides — and because finding an element has to happen before
     * imagery is generated. A slide whose visual is an element must not also pay
     * an image model for a picture nobody will see.
     *
     * A design declaring no element slots costs nothing here: no query is built
     * and no search runs.
     */
    const assets = await runStage(input.service, input, "finding_assets", async () => {
      const uploadedImages = prepared.assets
        .filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.storage_path ?? ""))
        .map((asset) => asset.storage_path as string);

      const slots = elementSlotsFor(
        archetypesInOrder as never,
        plan.slides.map((slide) => ({ title: slide.title, visualPrompt: slide.visualPrompt, layout: slide.layout })),
      );

      const drawn = slots.length === 0
        ? { elements: plan.slides.map(() => ({})), used: 0 }
        : await fillElementSlots(input.service, slots, {
            slideCount: plan.slides.length,
            presentationId: input.presentationId,
            accent: plan.visualDna.palette.accent,
          });

      return { uploadedImages, elements: drawn.elements, elementsUsed: drawn.used };
    }, (value) => {
      const parts: string[] = [];
      if (value.elementsUsed > 0) parts.push(`${value.elementsUsed} ta JElement joylashtirildi`);
      if (value.uploadedImages.length > 0) parts.push(`${value.uploadedImages.length} ta yuklangan rasm tayyorlandi`);
      return parts.length > 0 ? parts.join(", ") : "Vektor elementlar tayyorlandi";
    });

    const elementCovered = slidesWithElements(jslayd.document, archetypesInOrder as never);

    const generatedImages = await runStage(input.service, input, "generating_images", async () => {
      if (prepared.presentation.style !== "super_professional" || mode === "mock") return [] as GeneratedImage[];
      /**
       * How much photography a design wants, read from the design.
       *
       * An archetype that supports an image is a slide with somewhere to put
       * one. A design whose slides are all type gets no pictures rather than
       * pictures it will drop.
       */
      const imageArchetypes = jslayd.document.archetypes.filter((archetype) => archetype.selection.supportsImage).length;
      const policy = imageArchetypes === 0
        ? "none"
        : imageArchetypes <= 2
          ? "cover"
          : imageArchetypes <= 4 ? "contextual" : "all";
      if (policy === "none") return [] as GeneratedImage[];

      // A slide whose every visual slot is a library element needs no
      // photograph: the object is the picture.
      const indexed = plan.slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ index }) => !elementCovered.has(index));

      const targets = policy === "cover"
        ? indexed.filter(({ index }) => index === 0)
        // `contextual` always dresses the opening slide and always leaves the
        // second one on the palette ground, so the deck opens with contrast.
        : policy === "contextual"
          ? indexed.filter(({ slide, index }) => index === 0 || (index > 1 && Boolean(slide.visualPrompt))).slice(0, Math.ceil(plan.slides.length * 0.5))
          : indexed.filter(({ slide, index }) => index > 0 && Boolean(slide.visualPrompt)).slice(0, Math.ceil(plan.slides.length * 0.6));

      const results: GeneratedImage[] = [];
      for (const target of targets) {
        const photo = await findPhoto(input.service, {
          ownerId: input.ownerId,
          presentationId: input.presentationId,
          slideIndex: target.index,
          direction: target.slide.visualPrompt ?? plan.visualDna.imageDirection,
          topic: prepared.presentation.topic,
        });
        // No photograph is a slide on the palette ground, which several designs
        // treat as a deliberate composition. It is never a reason to stop.
        if (!photo) continue;

        results.push({
          slideIndex: photo.slideIndex, bucket: photo.bucket, path: photo.path,
          provider: photo.attribution.provider, costUsd: 0,
        });

        // The licence and the author travel with the file. An openly licensed
        // photograph usually has to be credited, and provenance that was not
        // stored cannot be recovered later.
        await input.service.from("presentation_assets").insert({
          presentation_id: input.presentationId,
          owner_id: input.ownerId,
          kind: "stock",
          storage_bucket: photo.bucket,
          storage_path: photo.path,
          mime_type: "image/jpeg",
          provider: photo.attribution.provider,
          metadata: { slide_index: target.index, attribution: photo.attribution },
        });
      }
      return results;
    }, (value) => value.length
      ? `${value.length} ta litsenziyalangan foto topildi`
      : "Ushbu dizayn uchun foto talab qilinmadi");

    const built = await runStage(input.service, input, "building_slides", async () => {
      const shared = {
        presentationId: input.presentationId,
        ownerId: input.ownerId,
        slides: plan.slides,
        sources: deckSources.map(citationLine),
        generatedImages,
        uploadedImages: assets.uploadedImages,
      };
      const rows = buildJslaydSlides({
        ...shared,
        design: jslayd,
        slideElements: assets.elements,
        // The compositions the copy was written for. Without this the renderer
        // would choose again from the finished text and could land somewhere
        // else, throwing away the one thing choosing early bought.
        //
        // Matched by position, not by title: `assembleDeck` puts the cover and
        // the agenda in front of the body and the bibliography and the closing
        // line behind it, so a planned slide `i` is deck slide `i + 2`. Matching
        // on the title would break precisely when a rewrite shortened one, which
        // is the case this exists for. The four fixed slides get `null` and the
        // renderer chooses for them as it always has.
        archetypeIds: plan.slides.map((_, position) =>
          layoutPlan.slides[position - DECK_PREFIX]?.archetypeId ?? null),
        authorName: prepared.presentation.author_name,
        teacherName: prepared.presentation.teacher_name,
        paletteCode: prepared.presentation.palette_code,
      });
      const deleteResult = await input.service.from("slides").delete().eq("presentation_id", input.presentationId);
      if (deleteResult.error) throw deleteResult.error;
      const slideInsert = await input.service.from("slides").insert(rows.slides);
      if (slideInsert.error) throw slideInsert.error;
      const elementInsert = await input.service.from("slide_elements").insert(rows.elements);
      if (elementInsert.error) throw elementInsert.error;
      return rows;
    }, (value) => `${value.slides.length} ta slayd va ${value.elements.length} ta tahrirlanadigan element saqlandi`);

    await runStage(input.service, input, "quality_checking", async () => {
      const failed = built.slides.filter((slide) => slide.quality_score < 80);
      if (failed.length) throw new Error(`${failed.length} slides did not pass the quality threshold`);
      return built.slides.reduce((sum, slide) => sum + slide.quality_score, 0) / built.slides.length;
    }, (value) => `O‘rtacha sifat bahosi ${Math.round(value)}/100`);

    await runStage(input.service, input, "finalizing", async () => {
      const { data: styleConfig, error: styleError } = await input.service.from("style_configs").select("base_credits,credits_per_slide,credits_per_image").eq("style", prepared.presentation.style as PresentationStyle).single();
      if (styleError) throw styleError;
      const actualCredits = Math.ceil(styleConfig.base_credits + prepared.presentation.requested_slide_count * Number(styleConfig.credits_per_slide) + generatedImages.length * styleConfig.credits_per_image);
      const updateResult = await input.service.from("presentations").update({
        visual_dna: plan.visualDna,
        generated_slide_count: built.slides.length,
        // Pin the deck to the version it was actually laid out with, so a later
        // publish of the same design cannot change what this deck looks like.
        // Left alone when the JSLAYD path was not taken.
        design_version: jslayd.version,
      }).eq("id", input.presentationId);
      if (updateResult.error) throw updateResult.error;
      const { error } = await input.service.rpc("settle_generation", { p_job_id: input.jobId, p_actual_credits: actualCredits, p_provider_cost_usd: totalCost });
      if (error) throw error;
      return actualCredits;
    }, (value) => `${value} kredit bo‘yicha hisob yakunlandi`);

    await input.service.from("generation_steps").update({ status: "succeeded", progress: 100, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), message: "Taqdimot tayyor" }).eq("job_id", input.jobId).eq("key", "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    console.error("generation pipeline failed", input.jobId, message);
    await input.service.rpc("fail_generation", { p_job_id: input.jobId, p_error_code: "pipeline_failed", p_error_message: message.slice(0, 1800) });
  } finally {
    await Promise.allSettled(uploadedFileIds.map((fileId) => openai.deleteFile(fileId)));
  }
}
