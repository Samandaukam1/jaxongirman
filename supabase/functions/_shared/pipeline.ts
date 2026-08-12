import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaletteFamily, SlideTemplate } from "./design-types.ts";
import { familyOf } from "./jslayd/index.ts";
import { buildJslaydSlides, readDesign, type ResolvedDesign } from "./jslayd-layout.ts";
import { buildSlides } from "./layout.ts";
import { OpenAIClient } from "./openai.ts";
import { resolvePalette } from "./palettes.ts";
import { contentSchema, outlineSchema } from "./plan-schema.ts";
import type { GeneratedImage, LayoutName, PresentationPlan, PresentationStyle, ResearchSource, SemanticSlide, VisualDna } from "./presentation-types.ts";
import { OpenAIImageProvider } from "./providers/image.ts";
import { resolveTemplate } from "./templates/index.ts";

type PipelineInput = { jobId: string; presentationId: string; ownerId: string; service: SupabaseClient; safetyIdentifier: string };
/** The model supplies narrative direction only — never colours or typography. */
type ModelDna = Pick<VisualDna, "mood" | "era" | "visualStyle" | "textures" | "imageDirection">;
type Outline = { visualDna: ModelDna; slides: Array<{ title: string; purpose: string; layout: LayoutName; visualPrompt: string | null }> };
type Content = { slides: Array<Omit<SemanticSlide, "purpose" | "layout" | "visualPrompt">> };

/** Merges the user's chosen design with the model's narrative direction. */
function composeVisualDna(model: ModelDna, template: SlideTemplate, palette: PaletteFamily): VisualDna {
  const { chartSeries: _series, ...tokens } = palette.tokens;
  return {
    ...model,
    palette: {
      background: tokens.background, surface: tokens.surface, primary: tokens.primary,
      secondary: tokens.secondary, accent: tokens.accent, textPrimary: tokens.textPrimary,
      textSecondary: tokens.textSecondary, border: tokens.border,
    },
    typography: template.artDirection.typography,
    illustrationStyle: template.artDirection.illustrationStyle,
    iconStyle: template.artDirection.decorativeElements.join(", "),
    decorativeElements: [...template.artDirection.decorativeElements],
    spacingStyle: template.artDirection.spacingStyle,
    chartStyle: template.artDirection.chartStyle,
    templateCode: template.code,
    paletteCode: palette.code,
  };
}

/**
 * Swaps a JSLAYD design's own colours into the direction the image provider
 * reads, so a generated photograph is lit for the design it will sit inside
 * rather than for a palette family the deck never uses.
 */
function applyJslaydColors(dna: VisualDna, design: ResolvedDesign, paletteCode: string | null): VisualDna {
  const colors = familyOf(design.document, paletteCode).colors;
  return {
    ...dna,
    palette: {
      background: colors.background,
      surface: colors.surface,
      primary: colors.primary,
      secondary: colors.secondary,
      accent: colors.accent,
      textPrimary: colors.text,
      textSecondary: colors.textSecondary,
      border: colors.border,
    },
    templateCode: design.document.design.slug,
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

async function providerPricing(service: SupabaseClient, textModel: string, imageModel: string) {
  const { data } = await service.from("app_settings").select("value").eq("key", "ai.provider_pricing").maybeSingle();
  const value = data?.value && typeof data.value === "object" && !Array.isArray(data.value) ? data.value as Record<string, unknown> : {};
  const text = value[textModel] as Record<string, number> | undefined;
  const image = value[imageModel] as Record<string, number> | undefined;
  return { inputPerMillion: Number(text?.input_per_million ?? 0), outputPerMillion: Number(text?.output_per_million ?? 0), imageCost: Number(image?.medium_landscape_per_image ?? 0) };
}

function usageCost(usage: { input_tokens?: number; output_tokens?: number }, pricing: { inputPerMillion: number; outputPerMillion: number }) {
  return ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion + ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion;
}

export async function runGenerationPipeline(input: PipelineInput): Promise<void> {
  const openai = new OpenAIClient();
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
      const prompt = `Mavzu: ${prepared.presentation.topic}\n\n1. Ishonchli manbalardan qidiring: rasmiy davlat saytlari, ilmiy nashrlar, statistika idoralari, universitetlar, ensiklopediyalar.\n2. 12–18 ta aniq dalil yozing: raqamlar, sanalar, ismlar, ta'riflar, sabab-oqibat bog'lanishlari. Har bir dalildan keyin qavs ichida manba havolasini bering.\n3. Manbalar bir-biriga zid bo'lsa, buni ochiq yozing.\n4. Manbasi topilmagan da'voni umuman yozmang — noaniqligini aytganingiz yaxshiroq.\n5. Oxirida eng muhim 5–8 ta manbani ro'yxat qilib bering.\nBiriktirilgan fayllar bo'lsa, ular ham kontekst hisoblanadi.`;
      try {
        const result = await openai.research([{ role: "system", content: system }, ...userInput(prompt, context.fileIds)], input.safetyIdentifier);
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

    const researchBrief = research.text.trim()
      ? `\n\nTEKSHIRILGAN MANBALAR VA DALILLAR (faqat shulardan foydalaning):\n${research.text.trim()}`
      : "";

    const outlineResult = await runStage(input.service, input, "creating_outline", async () => {
      if (mode === "mock") return { data: mockOutline(prepared.presentation.topic, contentCount), usage: {}, requestId: null };
      const system = "You are Jaxongir AI, a senior presentation strategist. Produce academically usable Uzbek Latin content architecture grounded in the supplied research. Every slide must advance a specific, concrete idea — never a vague heading. The visual design is fixed by the chosen template, so never propose colours, fonts or decoration. Return only the required schema.";
      const chosen = resolveTemplate(prepared.presentation.template_code, prepared.presentation.style as PresentationStyle);
      const prompt = `Mavzu: ${prepared.presentation.topic}\nMazmun slaydlari soni: ${contentCount}\nUslub: ${prepared.presentation.style}\nTanlangan dizayn: ${chosen.name} — ${chosen.tagline}. Art direction: ${chosen.artDirection.mood}; ${chosen.artDirection.illustrationStyle}.\n\nSarlavha, mavzular rejasi, foydalanilgan adabiyotlar va yakuniy slaydlarni server o'zi qo'shadi — ularni rejalashtirmang. Faqat ${contentCount} ta mazmun slaydini rejalashtiring va ularni mantiqiy ketma-ketlikda joylashtiring: tushuncha → tahlil → dalillar → amaliyot → xulosa.\nHar bir sarlavha aniq bo'lsin: "Kirish" emas, mavzu haqida nima aytilishini ayting.\nRaqam yoki statistika bor slayd uchun statistic yoki chart layoutini tanlang.\nVisual prompt faqat matnsiz illyustratsiyani tasvirlaydi va yuqoridagi art directionga mos bo'lishi kerak.${researchBrief}`;
      return openai.structured<Outline>([{ role: "system", content: system }, ...userInput(prompt, context.fileIds)], "presentation_outline", outlineSchema(contentCount), input.safetyIdentifier);
    }, (value) => `${value.data.slides.length} ta mazmun slaydi rejalashtirildi`);

    const contentResult = await runStage(input.service, input, "writing_content", async () => {
      if (mode === "mock") return { data: mockContent(outlineResult.data), usage: {}, requestId: null };
      const system = "You are an expert Uzbek Latin academic presentation writer. Follow the supplied outline exactly and ground every sentence in the supplied research. Write specific, checkable content: real numbers, dates, names and definitions instead of generalities. Grammar must be flawless Uzbek Latin. Never fabricate a quotation, statistic or date — if the research does not support it, write something the research does support instead. Return only the required schema.";
      const prompt = `Mavzu: ${prepared.presentation.topic}\nReja:\n${JSON.stringify(outlineResult.data.slides)}\n\nAynan ${contentCount} ta slayd uchun matn yozing.\n- subtitle: sarlavhani ochib beruvchi bitta qisqa jumla (bezakli yozuv). Har slaydda bo'lsin.\n- bullets: 3–5 ta band. Har biri to'liq, aniq fikr: raqam, sana, ism yoki aniq ta'rif bo'lsin. "Muhim ahamiyatga ega" kabi quruq iboralarni yozmang.\n- body: bandlarni bog'lovchi 1–2 jumlalik izoh, agar slayd shuni talab qilsa.\n- statistic: faqat tadqiqotda haqiqatan uchragan raqamni yozing.\n- chart: faqat tadqiqotdagi haqiqiy qiymatlar bilan to'ldiring.\n- table: faqat tadqiqotda haqiqatan jadval ko'rinishidagi ma'lumot bo'lsa to'ldiring; 2-6 ustun, 2-8 qator.\nBibliografiya yozmang — uni server alohida qo'shadi.${researchBrief}`;
      return openai.structured<Content>([{ role: "system", content: system }, ...userInput(prompt, context.fileIds)], "presentation_content", contentSchema(contentCount), input.safetyIdentifier);
    }, () => "Slayd matnlari yozildi va manbalarga bog‘landi");

    const template = resolveTemplate(prepared.presentation.template_code, prepared.presentation.style as PresentationStyle);
    const palette = resolvePalette(prepared.presentation.palette_code);

    // The design the user picked, when they picked a JSLAYD one. Resolved here
    // rather than at build time so a design that cannot be read is known before
    // a single credit is spent on imagery for a layout it will not use.
    const jslayd: ResolvedDesign | null = prepared.presentation.design_id
      ? await loadJslaydDesign(input.service, prepared.presentation.design_id, prepared.presentation.design_version)
      : null;

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

    const plan = await runStage(
      input.service,
      input,
      "visual_identity",
      async () => assembleDeck({
        topic: prepared.presentation.topic,
        authorName: prepared.presentation.author_name,
        teacherName: prepared.presentation.teacher_name,
        outline: outlineResult.data,
        content: contentResult.data,
        sources: deckSources,
        // A JSLAYD deck's imagery has to match the design it will be laid into,
        // so the design's own colours replace the picked palette family in the
        // direction the image provider reads. Everything else the model wrote —
        // mood, era, texture — is untouched.
        visualDna: jslayd
          ? applyJslaydColors(composeVisualDna(outlineResult.data.visualDna, template, palette), jslayd, prepared.presentation.palette_code)
          : composeVisualDna(outlineResult.data.visualDna, template, palette),
      }),
      () => jslayd
        ? `«${jslayd.document.design.name}» JSLAYD dizayni (v${jslayd.version}) qo‘llandi`
        : `«${template.name}» shabloni va «${palette.name}» rang oilasi qo‘llandi`,
    );
    const pricing = await providerPricing(input.service, openai.textModel, openai.imageModel);
    const researchCost = usageCost(research.usage, pricing);
    const outlineCost = usageCost(outlineResult.usage, pricing);
    const contentCost = usageCost(contentResult.usage, pricing);
    totalCost += researchCost + outlineCost + contentCost;
    if (mode === "real") {
      await input.service.from("ai_usage").insert([
        { owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId, provider: "openai", model: openai.textModel, operation: "topic_research", input_tokens: research.usage.input_tokens ?? 0, output_tokens: research.usage.output_tokens ?? 0, provider_cost_usd: researchCost, request_id: research.requestId },
        { owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId, provider: "openai", model: openai.textModel, operation: "presentation_outline", input_tokens: outlineResult.usage.input_tokens ?? 0, output_tokens: outlineResult.usage.output_tokens ?? 0, provider_cost_usd: outlineCost, request_id: outlineResult.requestId },
        { owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId, provider: "openai", model: openai.textModel, operation: "presentation_content", input_tokens: contentResult.usage.input_tokens ?? 0, output_tokens: contentResult.usage.output_tokens ?? 0, provider_cost_usd: contentCost, request_id: contentResult.requestId },
      ]);
    }

    await runStage(input.service, input, "building_layouts", async () => plan.slides, (value) => `${value.length} ta layout tanlandi`);

    const assets = await runStage(input.service, input, "finding_assets", async () => {
      const uploadedImages = prepared.assets.filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.storage_path ?? "")).map((asset) => asset.storage_path as string);
      return { uploadedImages };
    }, (value) => value.uploadedImages.length ? `${value.uploadedImages.length} ta yuklangan rasm tayyorlandi` : "Vektor elementlar tayyorlandi");

    const generatedImages = await runStage(input.service, input, "generating_images", async () => {
      if (prepared.presentation.style !== "super_professional" || mode === "mock") return [] as GeneratedImage[];
      // The template decides how much imagery its composition needs. A slide
      // without one falls back to the palette ground, which several templates
      // treat as a deliberate composition rather than a missing asset.
      const policy = template.artDirection.imagePolicy ?? "all";
      // A typographic design has nowhere to put a photograph, so it must not be
      // charged for one either.
      if (policy === "none") return [] as GeneratedImage[];
      const indexed = plan.slides.map((slide, index) => ({ slide, index }));
      const targets = policy === "cover"
        ? indexed.filter(({ index }) => index === 0)
        // `contextual` always dresses the opening slide and always leaves the
        // second one on the palette ground, so the deck opens with contrast.
        : policy === "contextual"
          ? indexed.filter(({ slide, index }) => index === 0 || (index > 1 && Boolean(slide.visualPrompt))).slice(0, Math.ceil(plan.slides.length * 0.5))
          : indexed.filter(({ slide, index }) => index > 0 && Boolean(slide.visualPrompt)).slice(0, Math.ceil(plan.slides.length * 0.6));
      const provider = new OpenAIImageProvider(openai, input.service, pricing.imageCost);
      const results: GeneratedImage[] = [];
      for (const target of targets) {
        const generated = await provider.generate({ ownerId: input.ownerId, presentationId: input.presentationId, slideIndex: target.index, topic: prepared.presentation.topic, direction: target.slide.visualPrompt ?? plan.visualDna.imageDirection, visualDna: plan.visualDna, template, palette });
        results.push(generated);
        totalCost += generated.costUsd;
        await input.service.from("presentation_assets").insert({ presentation_id: input.presentationId, owner_id: input.ownerId, kind: "generated", storage_bucket: generated.bucket, storage_path: generated.path, mime_type: "image/png", provider: generated.provider, metadata: { slide_index: target.index } });
      }
      if (results.length) await input.service.from("ai_usage").insert({ owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId, provider: "openai", model: openai.imageModel, operation: "image_generation", generated_images: results.length, provider_cost_usd: results.reduce((sum, item) => sum + item.costUsd, 0) });
      return results;
    }, (value) => value.length ? `${value.length} ta professional vizual yaratildi` : "Qo‘shimcha generativ rasm talab qilinmadi");

    const built = await runStage(input.service, input, "building_slides", async () => {
      const shared = {
        presentationId: input.presentationId,
        ownerId: input.ownerId,
        slides: plan.slides,
        sources: deckSources.map(citationLine),
        generatedImages,
        uploadedImages: assets.uploadedImages,
      };
      // A deck laid out by a published JSLAYD design, or — when the user never
      // chose one, or the design turns out to be unreadable — by the built-in
      // blueprint that has always built this deck. The fallback is the whole
      // point: a broken remote design costs a deck its new look, never its
      // existence (§72, §99).
      const rows = jslayd
        ? buildJslaydSlides({
            ...shared,
            design: jslayd,
            authorName: prepared.presentation.author_name,
            teacherName: prepared.presentation.teacher_name,
            paletteCode: prepared.presentation.palette_code,
          })
        : buildSlides({ ...shared, template, palette });
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
        ...(jslayd ? { design_version: jslayd.version } : {}),
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
