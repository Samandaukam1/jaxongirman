import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { elementSlotsFor, fillElementSlots, findIllustration, slidesWithElements } from "./jelement-visuals.ts";
import { familyOf, type ArchetypeWritingBrief } from "./jslayd/index.ts";
import {
  adaptContentToBrief, applyRewrite, briefForArchetype, briefForPrompt, findSlotProblems, planDeckLayout, requiredContentForBrief,
  reseatOverflowing,
  type SlotProblem,
} from "./layout-brief.ts";
import { buildJslaydSlides, readDesign, type ResolvedDesign } from "./jslayd-layout.ts";
import { geminiWriter } from "./gemini.ts";
import {
  attributionMetadata, ProviderUnavailable, userFacingFailure, type Attachment,
} from "./writer.ts";
import { outlineSchema, rewriteSchema, slideSchema } from "./plan-schema.ts";
import type { GeneratedImage, LayoutName, PresentationPlan, ResearchSource, SemanticSlide, VisualDna } from "./presentation-types.ts";
import { findPhoto } from "./providers/photo.ts";
import {
  asksFor, bindingsFromSlots, readTemplateAnswer, templatePrompt, templateSchema, usableSlots,
  TEMPLATE_SCHEMA_NAME, type WritableSlot,
} from "./pptx-writer.ts";
import {
  deckHasVisualStatistic, diversifyChartTypes, isVisualStatistic, requireVisualStatistic,
} from "./visual-statistic.ts";
import { composeGenerativeDeck, generativeEnabled } from "./scene-generation.ts";
import { deckPagesFrom } from "./scene-rows.ts";

type PipelineInput = { jobId: string; presentationId: string; ownerId: string; service: SupabaseClient };
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
    return design;
  }

  /**
   * What each page of the family is for, where there is such a thing.
   *
   * Only a design imported from a template has these, and only for the version
   * they were classified against — a design republished with different pages
   * must not be laid out by the old plan. No rows is the ordinary case and not
   * an error: a written design is chosen by shape, which is what it was
   * authored for.
   */
  const profiles = await service
    .from("design_slide_profiles")
    .select("archetype_id, role, alternative_roles, recommended_story_position, layout_signature, is_terminal, supports_image, supports_chart, supports_table, supports_quote, supports_stats, source_index, source_slide_part, text_map")
    .eq("design_id", designId)
    .eq("design_version", row.version);
  if (profiles.error) {
    console.error("jslayd slide profiles unavailable", designId, profiles.error.message);
    return design;
  }
  if ((profiles.data ?? []).length === 0) return design;

  const byId = new Map(design.document.archetypes.map((archetype) => [archetype.id, archetype]));
  return {
    ...design,
    profiles: (profiles.data ?? []).flatMap((profile) => {
      const archetype = byId.get(profile.archetype_id as string);
      if (!archetype) return [];
      // The text budget belongs to the archetype, not to the profile row: it is
      // derived from the composition and would be a second copy to keep in step.
      return [{
        archetypeId: profile.archetype_id as string,
        role: profile.role as never,
        alternativeRoles: (profile.alternative_roles ?? []) as never,
        recommendedStoryPosition: profile.recommended_story_position as number,
        layoutSignature: (profile.layout_signature ?? "") as string,
        isTerminal: Boolean(profile.is_terminal),
        supportsImage: Boolean(profile.supports_image),
        supportsChart: Boolean(profile.supports_chart),
        supportsTable: Boolean(profile.supports_table),
        supportsQuote: Boolean(profile.supports_quote),
        supportsStats: Boolean(profile.supports_stats),
        minText: archetype.selection.minText,
        maxText: archetype.selection.maxText,
        sourcePart: (profile.source_slide_part ?? "") as string,
        sourceIndex: (profile.source_index ?? 0) as number,
        // Every editable box of the source slide, measured at import. This is
        // what makes a template deck a template deck: the copy is written to
        // these and the exported file is the original slide with these
        // replaced.
        slots: (Array.isArray(profile.text_map) ? profile.text_map : []) as never,
      }];
    }),
  };
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
  const began = Date.now();
  await Promise.all([
    service.from("generation_jobs").update({ status: "running", stage: key, progress: stage[2], heartbeat_at: now, started_at: key === "preparing" ? now : undefined }).eq("id", input.jobId),
    service.from("generation_steps").update({ status: "running", progress: 5, started_at: now }).eq("job_id", input.jobId).eq("key", key),
  ]);
  try {
    const value = await action();
    const took = Date.now() - began;
    const recorded = await service.from("generation_steps").update({
      status: "succeeded", progress: 100, completed_at: new Date().toISOString(),
      duration_ms: took,
      message: successMessage?.(value) ?? null,
    }).eq("job_id", input.jobId).eq("key", key);
    // Read, not discarded. A column added minutes ago is missing from the API's
    // schema cache for a while, and an unchecked write in that window drops the
    // measurement silently — which is exactly how the photo credits went
    // missing for a year.
    if (recorded.error) console.error("stage metrics not stored", key, recorded.error.message);
    /**
     * One line per stage, in the log the platform already keeps.
     *
     * A stage that fails is easy to find; a stage that is *slowly getting
     * worse* is only visible if every run leaves its duration behind. This is
     * what turns "it feels slower lately" into a number.
     */
    console.log(JSON.stringify({ event: "stage_done", job_id: input.jobId, stage: key, duration_ms: took }));
    return value;
  } catch (error) {
    // The step list is on the author's screen while they wait, so it is subject
    // to the same rule as the failure itself: a provider's sentence about our
    // account never reaches it.
    const { code, message } = userFacingFailure(error);
    const took = Date.now() - began;
    await service.from("generation_steps").update({
      status: "failed", message: message.slice(0, 500), completed_at: new Date().toISOString(),
      duration_ms: took,
      // The stable code beside the sentence: a message is for a person, a code
      // is what a query groups by when one stage starts failing across decks.
      error_code: code,
    }).eq("job_id", input.jobId).eq("key", key);
    console.error(JSON.stringify({ event: "stage_failed", job_id: input.jobId, stage: key, duration_ms: took, error_code: code }));
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
    chart: slide.layout === "chart"
      ? { type: "bar", labels: ["Birinchi", "Ikkinchi", "Uchinchi"], values: [3, 2, 1] }
      : null,
    table: null,
  })) };
}

/**
 * What Gemini will accept inline, and nothing else.
 *
 * A Word document is not on the list. It was not really on the previous
 * provider's list either — it was uploaded and then largely ignored — so
 * skipping it loses nothing except the pretence that it was read.
 */
const READABLE = new Set([
  "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json",
  "image/png", "image/jpeg", "image/webp",
]);

/** One request carries the files. Ten megabytes of source is already far more than a deck needs. */
const ATTACHMENT_BUDGET = 10 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  // Chunked: spreading a multi-megabyte array into `String.fromCharCode`
  // overflows the argument stack, and does it only for large files, which is
  // the worst possible time to find out.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * The author's own material, carried in the request rather than uploaded.
 *
 * The files used to go to OpenAI's file store, which meant a deck's context
 * depended on an account balance and left objects behind that had to be
 * deleted in a `finally`. Inline data has neither problem: it exists for the
 * length of one HTTP request and belongs to nobody.
 *
 * A file that cannot be read is skipped, never fatal. Somebody who attached a
 * spreadsheet to a deck about mining wants the deck.
 */
async function readAttachments(
  service: SupabaseClient,
  assets: Array<{ storage_bucket?: string | null; storage_path?: string | null; mime_type?: string | null; byte_size?: number | null }>,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  let budget = ATTACHMENT_BUDGET;

  for (const asset of assets.slice(0, 5)) {
    if (!asset.storage_path) continue;
    if (asset.byte_size && asset.byte_size > budget) continue;

    const { data, error } = await service.storage
      .from(asset.storage_bucket ?? "user-uploads").download(asset.storage_path);
    if (error || !data) continue;

    const mimeType = (asset.mime_type ?? data.type ?? "").split(";")[0]?.trim() ?? "";
    if (!READABLE.has(mimeType)) continue;

    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > budget) continue;

    attachments.push({ mimeType, data: base64(bytes) });
    budget -= bytes.byteLength;
  }

  return attachments;
}

/**
 * Puts a table back the way the renderers read it.
 *
 * The model is asked for `rows: [{ cells: [...] }]` rather than an array of
 * arrays — see `plan-schema.ts` for why — and everything downstream expects
 * `string[][]`. One translation, at the boundary where the answer arrives.
 *
 * Both shapes are accepted. A model that ignores the wrapper and returns the
 * plain nested array has still answered the question, and refusing it would
 * lose a deck over punctuation.
 */
function flattenTableRows<T extends { table?: unknown }>(slide: T): T {
  const table = slide.table as { columns?: unknown; rows?: unknown } | null | undefined;
  if (!table || !Array.isArray(table.rows)) return slide;

  const rows = table.rows
    .map((row) => {
      if (Array.isArray(row)) return row.map((cell) => String(cell ?? ""));
      const cells = (row as { cells?: unknown })?.cells;
      return Array.isArray(cells) ? cells.map((cell) => String(cell ?? "")) : null;
    })
    .filter((row): row is string[] => row !== null && row.length > 0);

  // A table with no readable rows is not a table. Dropping it leaves the slide
  // to its other content rather than rendering an empty grid.
  return { ...slide, table: rows.length > 0 ? { ...table, rows } : null };
}


/**
 * Runs a list of jobs a few at a time, keeping the order of the answers.
 *
 * Fired all at once, ten slide requests earn a rate limit; run one after
 * another they take ten times as long as they need to. Three is enough to hide
 * the latency and few enough that Gemini never objects.
 */
/**
 * A ceiling on how long a stage may take, whatever it is waiting on.
 *
 * Per-call timeouts bound one request; they do not bound a stage that makes
 * many, and three retries of a slow provider across several slides can outlast
 * the wall clock an edge function is given. When that happens the worker is
 * killed mid-stage, no code runs, and the job sits at `running` for ever.
 *
 * A stage that gives up on its own terms leaves a failed job, a released
 * reservation and a sentence for the author. That is strictly better than being
 * killed, so the deadline is set below the platform's rather than above it.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, stage: string): Promise<T> {
  let alarm: number | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    alarm = setTimeout(
      () => reject(new ProviderUnavailable("timeout", `${stage} did not finish within ${Math.round(ms / 1000)}s`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    if (alarm !== undefined) clearTimeout(alarm);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** One slide's copy, and what it cost. */
type SlideWrite = {
  index: number;
  slide: Content["slides"][number];
  usage: { input_tokens?: number; output_tokens?: number };
  attempts: number;
};

/**
 * Writes one slide.
 *
 * The deck used to be one request whose schema grew with the slide count, and
 * Gemini refused it: one slide was accepted, six were not, and the refusal
 * scaled with the count rather than with anything in the vocabulary. So the
 * count now changes how many requests are made and never how large one is.
 *
 * What travels is only what this slide needs — its own purpose, the archetype
 * it will be laid into, the slide before and after it for continuity, and the
 * research. Not the other archetypes, not the other briefs, not the rest of the
 * deck's copy.
 */
/**
 * What each story role asks the writer for.
 *
 * Said as an instruction rather than as a label: `challenges` tells a model
 * nothing, and "name the real obstacles" tells it what sentence to write. The
 * roles a design cannot influence — a cover, a sign-off — are absent, because
 * the server writes those slides itself.
 */
const ROLE_INSTRUCTION: Record<string, string> = {
  welcome: "ochilish — mavzuni bir jumlada qo'ying",
  introduction: "kirish — mavzu nima ekanini va nega bu haqda gapirilayotganini ayting",
  overview: "umumiy ko'rinish — keyin nima kelishini qisqa sanang",
  key_concepts: "asosiy tushunchalar — atamalarni aniq ta'riflang",
  importance: "ahamiyati — nima uchun muhimligini dalil bilan ko'rsating",
  types: "turlari — ajratib sanang va farqini ayting",
  structure: "tuzilishi — qismlarini va ular qanday bog'lanishini ayting",
  process: "jarayon — bosqichlarni tartib bilan bering",
  methods: "usullar — qanday qilinishini aniq ayting",
  analysis: "tahlil — ma'lumotdan xulosa chiqaring, faqat sanab o'tmang",
  challenges: "muammolar — haqiqiy to'siqlarni nomlang",
  solutions: "yechimlar — yuqoridagi muammolarga aniq javob bering",
  applications: "qo'llanilishi — amalda qayerda ishlatilishini ayting",
  examples: "misollar — aniq, tekshirib bo'ladigan misol keltiring",
  results: "natijalar — raqam va o'lchov bilan",
  recommendations: "tavsiyalar — bajariladigan qadamlar",
  conclusion: "xulosa — aytilganlardan chiqadigan asosiy fikr",
  agenda: "reja — mavzular ro'yxati",
  timeline: "vaqt chizig'i — sanalar bo'yicha",
  comparison: "taqqoslash — ikki tomonni yonma-yon qo'ying",
  big_number: "bitta katta raqam va uni tushuntiruvchi qisqa izoh",
  quote: "iqtibos — tadqiqotda haqiqatan uchragan gap",
  case_study: "amaliy misol — bitta holatni boshidan oxirigacha",
  data: "ma'lumot — raqamlar va ularning manbasi",
  image_story: "rasm asosiy o'rinda — matn qisqa bo'lsin",
};

async function writeOneSlide(input: {
  writer: ReturnType<typeof geminiWriter>;
  topic: string;
  index: number;
  outline: Outline["slides"][number];
  previous: string | null;
  next: string | null;
  brief: ArchetypeWritingBrief | null;
  /** What this page is for in the talk, where the design says. */
  role?: string;
  researchBrief: string;
  attachments: readonly Attachment[];
}): Promise<SlideWrite> {
  const system = "You are an expert Uzbek Latin academic presentation writer working to a fixed layout. Ground every sentence in the supplied research. Write specific, checkable content: real numbers, dates, names and definitions instead of generalities. Grammar must be flawless Uzbek Latin. Never fabricate a quotation, statistic or date — if the research does not support it, write something the research does support instead. The layout is fixed and is not yours to change: write copy that fits the boxes you are given. Return only the required schema.";

  const prompt = [
    `Mavzu: ${input.topic}`,
    `Slayd ${input.index + 1}: ${input.outline.title}`,
    `Maqsad: ${input.outline.purpose}`,
    // A page composed to state a problem and a page composed to answer one hold
    // the same number of characters and want entirely different sentences. The
    // budget cannot say that; the role can.
    input.role ? `Bu sahifaning vazifasi: ${ROLE_INSTRUCTION[input.role] ?? input.role}` : null,
    input.previous ? `Oldingi slayd: ${input.previous}` : null,
    input.next ? `Keyingi slayd: ${input.next}` : null,
    "",
    "Faqat SHU slayd uchun matn yozing.",
    /**
     * The instruction that was actually deciding the length.
     *
     * The design measures each box and the brief carries the number; this line
     * said "one or two sentences" and the writer obeyed it, filling a quarter
     * of a box built for a paragraph on every content slide of every deck. The
     * budget was never the constraint — this sentence was.
     */
    "- subtitle: sarlavhani ochib beruvchi 1–2 jumla.",
    "- bullets: 4–6 ta band. Har biri to'liq fikr: raqam, sana, ism yoki ta'rif bilan. \"Muhim ahamiyatga ega\" kabi quruq iboralarni yozmang.",
    "- body: DIZAYN O'LCHOVLARIdagi \"sentences\" soniga teng to'liq jumla yozing (odatda 4–6). Har bir fikrni rivojlantiring: da'vo, sabab yoki mexanizm, natija yoki aniq misol. Bir-ikki jumla bilan cheklanmang.",
    "- statistic: faqat tadqiqotda haqiqatan uchragan raqam.",
    input.outline.layout === "chart"
      ? "- chart: MAJBURIY. Faqat tekshirilgan manbadagi bir xil birlikda o‘lchangan 2–8 ta qiymatni yozing. type faqat bar yoki donut bo‘lsin; donut faqat qiymatlar bir butunning qismlari bo‘lsa ishlatiladi. Raqam o‘ylab topmang."
      : "- chart: faqat tadqiqotdagi haqiqiy qiymatlar; kerak bo‘lmasa null.",
    "- table: faqat haqiqatan jadval ko'rinishidagi ma'lumot bo'lsa; har qator {\"cells\": [...]}.",
    "Kerak bo'lmagan maydonni null qoldiring.",
    input.brief ? `\nDIZAYN O'LCHOVLARI (\"sentences\" — nechta jumla, \"min\" — eng kam belgi, \"aim\" — mo'ljal, \"limit\" — qat'iy chegara):\n${JSON.stringify(input.brief)}` : "",
    input.researchBrief,
  ].filter(Boolean).join("\n");

  const answer = await input.writer.structured<Content["slides"][number]>({
    prompt: `${system}\n\n${prompt}`,
    system,
    schemaName: "presentation_slide",
    schema: slideSchema({ requireVisualStatistic: input.outline.layout === "chart" }),
    attachments: input.attachments,
    // One slide's worth. The old sixteen thousand was for ten of them at once.
    maxOutputTokens: 2_400,
  });

  if (input.outline.layout === "chart" && !isVisualStatistic(answer.data.chart)) {
    // The schema rejects a missing chart in normal operation. Keep a runtime
    // check at the boundary as well: labels and values must have equal lengths,
    // which JSON Schema cannot express without making the prompt enormous.
    throw new Error("Majburiy vizual statistika yaroqli bar yoki doira diagrammasi bo‘lib qaytmadi.");
  }

  return { index: input.index, slide: answer.data, usage: answer.usage, attempts: answer.attempts };
}

/**
 * One slide of a deck whose design is an imported PowerPoint template.
 *
 * The same cost as an ordinary slide — one request — and a different question.
 * An ordinary slide asks for fields and lets the renderer place them; this asks
 * for the boxes the template actually has, at the lengths the designer used,
 * and the finished file is the original slide with exactly those replaced.
 *
 * What comes back is turned into the ordinary shape as well, so the preview,
 * the PDF and the phone's editor carry on unchanged.
 */
async function writeTemplateSlide(input: {
  writer: ReturnType<typeof geminiWriter>;
  topic: string;
  index: number;
  outline: Outline["slides"][number];
  previous: string | null;
  role?: string;
  slots: readonly WritableSlot[];
  researchBrief: string;
  attachments: readonly Attachment[];
}): Promise<SlideWrite & { texts: Map<string, string>; filled: string[]; trimmed: string[] }> {
  const system = "You are an expert Uzbek Latin presentation writer filling the text boxes of a fixed, professionally designed slide. The design cannot change: every box has a size, a type size and a length the designer chose, and your copy has to fit it. Ground every sentence in the supplied research, never fabricate a number or a name, and never reuse or translate the template's own sample words. Grammar must be flawless Uzbek Latin. Return only the required schema.";
  const prompt = templatePrompt({
    topic: input.topic,
    index: input.index,
    title: input.outline.title,
    purpose: input.outline.purpose,
    ...(input.role ? { roleNote: ROLE_INSTRUCTION[input.role] ?? input.role } : {}),
    previous: input.previous,
    researchBrief: input.researchBrief,
    asks: asksFor(input.slots),
  });

  const answer = await input.writer.structured<unknown>({
    prompt: `${system}\n\n${prompt}`,
    system,
    schemaName: TEMPLATE_SCHEMA_NAME,
    schema: templateSchema(),
    attachments: input.attachments,
    maxOutputTokens: 2_400,
  });

  const fill = readTemplateAnswer(answer.data, input.slots, { title: input.outline.title });
  const bound = bindingsFromSlots(input.slots, fill.texts);

  return {
    index: input.index,
    slide: {
      subtitle: bound.subtitle,
      body: bound.body,
      bullets: bound.bullets,
      quote: null, statistic: null, chart: null, table: null,
      visualPrompt: null,
    } as never,
    usage: answer.usage,
    attempts: answer.attempts,
    texts: fill.texts,
    filled: fill.filled,
    trimmed: fill.trimmed,
  };
}

/**
 * Asks the defence function to write this deck's script.
 *
 * A function-to-function call rather than importing the writer here. The script
 * is a different document with a different failure mode and a different cost,
 * and a deck that is already finished should not be able to fail because of it.
 * The caller does not await this.
 */
async function writeDefenseScript(input: { presentationId: string; ownerId: string; service: SupabaseClient }): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  const response = await fetch(`${url}/functions/v1/generate-defense`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      // The function reads the caller from the token; the service role is not a
      // person, so the deck's owner is named explicitly.
      "x-owner-id": input.ownerId,
    },
    body: JSON.stringify({ presentationId: input.presentationId, action: "write" }),
  });
  if (!response.ok) {
    throw new Error(`defense function returned ${response.status}`);
  }
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
  // Every word of the deck comes from here. There is no second text provider to
  // fall to, which is the point: the one that used to be there is what failed a
  // paid generation at twenty-eight per cent when nobody had topped it up.
  const writer = geminiWriter();
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
    // Fail here rather than at twenty-eight per cent. A job that cannot be
    // written should never have charged for a progress bar.
    if (mode === "real" && !writer.configured) {
      throw new ProviderUnavailable("not_configured", "GEMINI_API_KEY is not set");
    }

    // A boolean and two model names. Enough to tell, from a production log,
    // which model wrote a given deck; never enough to reconstruct a key.
    console.log(JSON.stringify({
      event: "generation_provider",
      job_id: input.jobId,
      gemini_configured: writer.configured,
      gemini_research_model: writer.researchModel,
      gemini_writing_model: writer.writingModel,
    }));

    const context = await runStage(input.service, input, "understanding_topic", async () => {
      if (mode === "mock") return { attachments: [] as Attachment[] };
      const attachments = await readAttachments(input.service, prepared.assets);
      return { attachments };
    }, (value) => value.attachments.length ? `${value.attachments.length} ta material kontekst sifatida tayyorlandi` : "Mavzu tahlilga tayyorlandi");

    // The deck always opens with a title page and an agenda and closes with a
    // bibliography and a thank-you, so the model only writes what sits between.
    const contentCount = Math.max(1, prepared.presentation.requested_slide_count - SPECIAL_SLIDES);

    const research = await runStage(input.service, input, "researching", async () => {
      const empty = {
        text: "",
        citations: [] as { title: string; url: string }[],
        usage: {} as { input_tokens?: number; output_tokens?: number },
        requestId: null as string | null,
        provider: "google" as const,
        model: writer.researchModel,
        attempts: 0,
        groundedSearch: false,
      };
      if (mode === "mock") return { ...empty, failure: null as string | null };
      const system = "You are a research assistant for Uzbek-language academic presentations. Search the live web before answering and report only what the pages you opened actually say. Never state a fact you could not find a source for. Write in Uzbek Latin script.";
      // Notes, not an essay. This stage was spending 30–45k input tokens on
      // prose that the writing stage then compressed away — a deck needs the
      // facts, and the facts are short. Asking for them as a list rather than
      // as exposition is most of the saving.
      const prompt = `Mavzu: ${prepared.presentation.topic}\n\nIshonchli manbalardan qidiring: rasmiy saytlar, ilmiy nashrlar, statistika idoralari, universitetlar.\nQuyidagilarni QISQA ro'yxat qilib yozing — izoh va kirish so'zlarisiz:\n- FAKTLAR: 8–12 ta aniq dalil, har biri bir qatorda, qavsda manba.\n- RAQAMLAR: 4–8 ta statistika, yil va manba bilan.\n- DIAGRAMMA UCHUN: kamida 2 ta o‘zaro taqqoslanadigan qiymatni bir xil birlik, yil va bitta aniq manba bilan bering. Ulushlar bo‘lsa jami nimani anglatishini yozing.\n- TA'RIFLAR: 2–4 ta asosiy tushuncha, bir jumladan.\n- MANBALAR: 5–8 ta havola.\nManbasi yo'q da'voni yozmang. Uzun paragraf yozmang.\nBiriktirilgan fayllar bo'lsa, ular ham kontekst hisoblanadi.`;
      try {
        const result = await writer.research({
          prompt: `${system}\n\n${prompt}`,
          system,
          attachments: context.attachments,
          maxOutputTokens: 2_500,
        });
        return { ...result, failure: null as string | null };
      } catch (error) {
        // The writer already tried the live web three times and then tried the
        // same question without it. Reaching here means Gemini itself is not
        // answering at all — but a deck can still be written from what the
        // outline and writing stages know, so this is reported and survived
        // rather than thrown.
        const reason = error instanceof ProviderUnavailable ? error.reason : "unknown";
        console.error(JSON.stringify({ event: "research_failed", job_id: input.jobId, reason }));
        return { ...empty, failure: reason };
      }
    }, (value) => value.failure
      ? "Internet qidiruvi ishlamadi — matn model bilimidan yozildi"
      : !value.groundedSearch
        ? "Internet qidiruvi mavjud emas — matn model bilimidan yozildi"
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
      if (mode === "mock") return { data: mockOutline(prepared.presentation.topic, contentCount), usage: {}, requestId: null, provider: "google" as const, model: writer.writingModel, attempts: 1 };
      const system = "You are Jaxongir AI, a senior presentation strategist. Produce academically usable Uzbek Latin content architecture grounded in the supplied research. Every slide must advance a specific, concrete idea — never a vague heading. The visual design is fixed by the chosen design, so never propose colours, fonts or decoration. Return only the required schema.";
      const prompt = `Mavzu: ${prepared.presentation.topic}\nMazmun slaydlari soni: ${contentCount}\nUslub: ${prepared.presentation.style}\nTanlangan dizayn: ${jslayd.document.design.name} — ${jslayd.document.design.description}.\n\nSarlavha, mavzular rejasi, foydalanilgan adabiyotlar va yakuniy slaydlarni server o'zi qo'shadi — ularni rejalashtirmang. Faqat ${contentCount} ta mazmun slaydini rejalashtiring va ularni mantiqiy ketma-ketlikda joylashtiring: tushuncha → tahlil → dalillar → amaliyot → xulosa.\nHar bir sarlavha aniq bo'lsin: "Kirish" emas, mavzu haqida nima aytilishini ayting.\nKamida BITTA slayd layoutini chart qiling: u tekshirilgan raqamlarni bar yoki doira diagrammasida ko‘rsatadi. Diagramma uchun uydirma raqam ishlatmang.\nVisual prompt faqat matnsiz illyustratsiyani tasvirlaydi va yuqoridagi art directionga mos bo'lishi kerak.${researchBrief}`;
      return writer.structured<Outline>({
        prompt: `${system}\n\n${prompt}`,
        system,
        schemaName: "presentation_outline",
        schema: outlineSchema(contentCount),
        attachments: context.attachments,
      });
    }, (value) => `${value.data.slides.length} ta mazmun slaydi rejalashtirildi`);

    // A model instruction is not a product invariant. If the outline omitted
    // the chart, deterministically assign the most numeric slide (or a middle
    // content slide) before its archetype and writing budget are chosen.
    outlineResult.data.slides = requireVisualStatistic(outlineResult.data.slides) as Outline["slides"];

    /**
     * The generative engine, where the operator has switched it on.
     *
     * Everything above this line is shared — a deck still needs its topic
     * understood, its sources found and its outline planned, whichever engine
     * lays it out. Below it the two paths diverge completely: this one composes
     * each page for its own content, and the JSLAYD path below chooses from
     * designs somebody authored.
     *
     * There is no silent fallback between them. A generative run that fails
     * fails the job with its own message, because a deck that quietly came out
     * of the old engine is a deck nobody can tell apart afterwards — and then
     * nobody knows which engine is actually running.
     */
    if (await generativeEnabled(input.service)) {
      await runGenerative({
        input,
        writer,
        presentation: prepared.presentation,
        outline: outlineResult.data,
        research: research.text,
        addCost: (amount) => { totalCost += amount; },
        pricing: await providerPricing(input.service),
      });
      return;
    }

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
      // Where the design knows what its pages are for, the deck is planned as a
      // story and the writer is told which part of it each slide carries.
      jslayd.profiles ? { profiles: jslayd.profiles } : {},
    );

    const layoutInstruction = `\n\nDIZAYN O'LCHOVLARI — matn shu qutilarga yozilishi kerak.\n`
      + `Har slayd o'z arxetipiga ega. "min" — eng kami, "aim" — mo'ljal, "limit" — qat'iy chegara (belgi soni).\n`
      + `Har bir maydonni "aim" ga yaqin yozing: "min" dan kam yozish MUMKIN EMAS, "limit" dan oshmang.\n`
      + `"sentences" bor maydonlarda shuncha to'liq jumla yozing — bir jumla bilan cheklanmang. `
      + `Har bir fikrni rivojlantiring: da'vo, sabab yoki mexanizm, natija yoki aniq misol.\n`
      + `Har bir slaydda kamida bitta mazmun maydoni (body, bullets, quote yoki statistic) to'ldirilgan bo'lsin — `
      + `faqat sarlavhadan iborat slayd bo'lmasin.\n`
      + `Sarlavhada zarur bo'lsa \\n bilan mantiqiy joydan qator ajrating; oxirgi qator bitta qisqa so'z bo'lib qolmasin.\n`
      + `Arxetiplar:\n${JSON.stringify(layoutPlan.briefs.map(briefForPrompt))}\n`
      + `Slaydlar: ${JSON.stringify(layoutPlan.slides.map((slide) => ({ i: slide.index, archetype: slide.archetypeId })))}`;

    /**
     * The copy, one slide at a time.
     *
     * This was a single request carrying every slide, and Gemini refused it:
     * one slide was accepted and six were not, with INVALID_ARGUMENT naming
     * nothing, and the refusal followed the count rather than any keyword. So
     * the deck's length changes how many requests are made and never how large
     * one of them is.
     *
     * Everything downstream already worked a slide at a time — a slot budget, a
     * fit check, a rewrite — so this is the unit the rest of the pipeline was
     * built in.
     */
    const briefById = new Map(layoutPlan.briefs.map((brief) => [brief.archetypeId, brief]));

    /**
     * The boxes of each source slide, where this design is an imported file.
     *
     * Present means the deck is written box by box and exported by cloning the
     * original package; absent means the ordinary path, unchanged. Nothing
     * decides this twice — one map, read by the writer and by the renderer.
     */
    const slotsByArchetype = new Map<string, readonly WritableSlot[]>();
    const staleTemplatePages: string[] = [];
    for (const profile of jslayd.profiles ?? []) {
      if (!profile.sourcePart) continue;
      const usable = usableSlots(profile.slots ?? []);
      if (usable.length > 0) slotsByArchetype.set(profile.archetypeId, usable);
      else staleTemplatePages.push(profile.archetypeId);
    }
    const isTemplate = slotsByArchetype.size > 0;

    /**
     * A template imported before its boxes were measured cannot be written to.
     *
     * Refused here rather than discovered at export: the alternative is a deck
     * that costs a person their credits, takes several minutes, and then will
     * not produce the PowerPoint file it was made for. Falling back to drawing
     * it is not available — a PPTX design is never drawn — so the honest answer
     * is to stop and say which one to re-import.
     */
    if (staleTemplatePages.length > 0 && staleTemplatePages.length === (jslayd.profiles ?? []).length) {
      throw new Error(
        `«${jslayd.document.design.name}» shabloni eski formatda import qilingan. `
        + "Admin panelda uni qayta import qiling.",
      );
    }
    /** What each deck slide's boxes will say, by shape id. */
    const templateText = new Map<number, Record<string, string>>();

    /**
     * The stage that used to hang, now with a floor under it.
     *
     * Writing is many requests, and the slowest healthy run observed finished
     * the whole deck in about a hundred seconds. Two hundred is generous for
     * the stage alone and still short of the wall clock the worker is given, so
     * a stage that goes wrong fails in our own words instead of being killed
     * without any.
     */
    const contentResult = await withDeadline(runStage(input.service, input, "writing_content", async () => {
      if (mode === "mock") {
        return {
          slides: mockContent(outlineResult.data).slides,
          usage: {} as { input_tokens?: number; output_tokens?: number },
          calls: 0,
          attempts: 1,
        };
      }

      let done = 0;
      /**
       * Proof of life, per slide.
       *
       * The stage used to touch `heartbeat_at` once on entry, so a run that
       * died on the last slide looked exactly like one that died on the first,
       * and the watchdog could not tell a long deck from a dead one. Now each
       * finished slide says so — which is also the log line that names where a
       * stall actually happened.
       */
      const beat = async (index: number) => {
        done += 1;
        console.log(JSON.stringify({
          event: "slide_written", job_id: input.jobId, slide: index, done, of: outlineResult.data.slides.length,
        }));
        await input.service.from("generation_jobs")
          .update({ heartbeat_at: new Date().toISOString() }).eq("id", input.jobId);
      };

      const written = await mapWithConcurrency(outlineResult.data.slides, 3, async (slide, index) => {
        const planned = layoutPlan.slides.find((entry) => entry.index === index);
        const brief = planned ? briefById.get(planned.archetypeId) : undefined;
        const slots = planned ? slotsByArchetype.get(planned.archetypeId) : undefined;

        // A template page is written into its own boxes rather than into the
        // design's fields: same one request, different question.
        if (slots && slots.length > 0) {
          let answer = await writeTemplateSlide({
            writer,
            topic: prepared.presentation.topic,
            index,
            outline: slide,
            previous: outlineResult.data.slides[index - 1]?.title ?? null,
            ...(planned?.role ? { role: planned.role } : {}),
            slots,
            researchBrief,
            attachments: context.attachments,
          });

          /**
           * A template writer answers for the page's text boxes, not for a
           * semantic chart field. That used to make every imported-PPTX design
           * return `chart: null`, even when the outline deliberately reserved
           * this page for the required visual statistic.
           *
           * Ask the ordinary grounded slide writer for the chart payload only.
           * The template answer still owns every word and every measured box;
           * this second answer contributes just the verified labels and
           * values that both the preview and the clone exporter can draw.
           */
          if (slide.layout === "chart") {
            const chartAnswer = await writeOneSlide({
              writer,
              topic: prepared.presentation.topic,
              index,
              outline: slide,
              previous: outlineResult.data.slides[index - 1]?.title ?? null,
              next: outlineResult.data.slides[index + 1]?.purpose ?? null,
              brief: null,
              ...(planned?.role ? { role: planned.role } : {}),
              researchBrief,
              attachments: context.attachments,
            });
            answer = {
              ...answer,
              slide: { ...answer.slide, chart: chartAnswer.slide.chart },
              usage: {
                input_tokens: (answer.usage.input_tokens ?? 0) + (chartAnswer.usage.input_tokens ?? 0),
                output_tokens: (answer.usage.output_tokens ?? 0) + (chartAnswer.usage.output_tokens ?? 0),
              },
              attempts: answer.attempts + chartAnswer.attempts,
            };
          }
          templateText.set(index, Object.fromEntries(answer.texts));
          await beat(index);
          if (answer.filled.length > 0 || answer.trimmed.length > 0) {
            console.log(JSON.stringify({
              event: "template_slide_repaired",
              job_id: input.jobId,
              slide: index,
              filled: answer.filled.length,
              trimmed: answer.trimmed.length,
            }));
          }
          return answer;
        }

        try {
          const one = await writeOneSlide({
            writer,
            topic: prepared.presentation.topic,
            index,
            outline: slide,
            previous: outlineResult.data.slides[index - 1]?.title ?? null,
            next: outlineResult.data.slides[index + 1]?.purpose ?? null,
            brief: brief ? briefForPrompt(brief) : null,
            ...(planned?.role ? { role: planned.role } : {}),
            researchBrief,
            attachments: context.attachments,
          });
          await beat(index);
          return one;
        } catch (failure) {
          // One more ask for this slide alone. The writer has already retried
          // what is worth retrying; this covers the answer that came back
          // unusable rather than the request that never landed.
          console.error(JSON.stringify({
            event: "slide_write_retry",
            job_id: input.jobId,
            slide: index,
            reason: failure instanceof ProviderUnavailable ? failure.reason : "unknown",
          }));
          const retried = await writeOneSlide({
            writer,
            topic: prepared.presentation.topic,
            index,
            outline: slide,
            previous: null,
            next: null,
            brief: brief ? briefForPrompt(brief) : null,
            ...(planned?.role ? { role: planned.role } : {}),
            researchBrief,
            attachments: [],
          });
          await beat(index);
          return retried;
        }
      });

      return {
        // `mapWithConcurrency` keeps the order, so the nth answer is the nth
        // slide however the requests finished.
        slides: written.map((entry) => entry.slide),
        // Kept per slide as well as summed: a deck that cost twice what it
        // should did so on one slide, and an aggregate cannot say which.
        entries: written,
        usage: written.reduce((total, entry) => ({
          input_tokens: (total.input_tokens ?? 0) + (entry.usage.input_tokens ?? 0),
          output_tokens: (total.output_tokens ?? 0) + (entry.usage.output_tokens ?? 0),
        }), {} as { input_tokens?: number; output_tokens?: number }),
        calls: written.length,
        attempts: written.reduce((total, entry) => total + entry.attempts, 0),
      };
    }, (value) => `${value.slides.length} ta slayd alohida yozildi`), 200_000, "writing_content");


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
    // Rows come back wrapped, one object per row, because Gemini answers a
    // nested array badly and refused the request that carried one. Unwrapped
    // here so nothing past this line knows the difference.
    const writtenSlides = contentResult.slides.map(flattenTableRows);
    /**
     * Make every slide's shape match the composition it is planned for.
     *
     * Called again whenever that composition can have changed. A slide written
     * as a list, adapted for a page that draws lists, and then *reseated* onto
     * a page that draws only a paragraph was converted afterwards by the
     * renderer — long after the last fit check — and arrived at 2097
     * characters in a box measured for 578. The conversion is cheap and pure;
     * running it once was the mistake.
     */
    const briefFor = (archetypeId: string) => {
      const known = briefById.get(archetypeId);
      if (known) return known;
      const built = briefForArchetype(jslayd.document, archetypeId, { language: "uz" });
      if (built) briefById.set(archetypeId, built);
      return built ?? undefined;
    };

    const adaptAll = () => {
      if (isTemplate) return;
      for (const planned of layoutPlan.slides) {
        const brief = briefFor(planned.archetypeId);
        const written = writtenSlides[planned.index];
        if (brief && written) writtenSlides[planned.index] = adaptContentToBrief(written as never, brief) as never;
      }
    };
    adaptAll();
    let rewriteUsage = { input_tokens: 0, output_tokens: 0 };
    let rewrites = 0;
    /** Appended to the layout stage's message when copy still does not fit. */
    let fitReport = "";
    let rewriteAttribution: { provider: string; model: string; attempts: number } =
      { provider: "google", model: writer.writingModel, attempts: 0 };

    /**
     * Copy for a template page is fitted where it is written, not afterwards.
     *
     * The rewrite loop below measures against the archetype's own budgets, and
     * for an imported page those are a second, worse statement of a box this
     * pipeline already has the real measurements for. Running it would ask a
     * model to shorten copy that fits, and reseating would move a slide onto a
     * different source page after its words were written for this one's shapes.
     */
    if (mode !== "mock" && !isTemplate) {
      /**
       * One pass: adapt, measure, and rewrite whatever does not fit.
       *
       * A function rather than a loop body because it has to run again
       * after the reseat below. Moving a slide to a different composition
       * changes which boxes exist, which changes whether a list becomes a
       * paragraph — and a paragraph nobody measured is how 1649 characters
       * reached a box built for 578.
       */
      const fitPass = async (): Promise<number> => {
        adaptAll();
        const failing: { index: number; problems: SlotProblem[] }[] = [];

        layoutPlan.slides.forEach((planned) => {
          const brief = briefFor(planned.archetypeId);
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

        if (failing.length === 0) return 0;

        const request = failing.map((entry) => ({
          slide: entry.index,
          /**
           * What the slide is about, sent with every request.
           *
           * Shortening needs no context — the meaning is in the sentence being
           * cut. Expanding an empty box needs all of it: the first attempt at
           * this sent the field name and an empty string, and the model
           * returned an empty string back, correctly, because nothing in the
           * request said what the slide was for.
           */
          about: {
            title: outlineResult.data.slides[entry.index]?.title ?? "",
            purpose: outlineResult.data.slides[entry.index]?.purpose ?? "",
            topic: prepared.presentation.topic,
          },
          fields: entry.problems.map((problem) => ({
            field: problem.binding,
            current: problem.text,
            maxCharacters: problem.maximumCharacters,
            aimCharacters: problem.aim,
            maxLines: problem.maximumLines,
            issue: problem.orphan
              ? "last line is a single short word"
              : problem.overBy > 0
                ? `${problem.overBy} characters too long`
                : problem.text
                  ? `too short: ${problem.text.length} characters where the box holds ${problem.aim}`
                  : "this box is empty and the slide says nothing",
            // Characters are not a unit a model can count in. Sentences are.
            ...(problem.direction === "expand"
              ? { add: `${Math.max(1, Math.round((problem.aim - problem.text.length) / 110))} ta qo'shimcha jumla` }
              : {}),
          })),
        }));

        /**
         * Both directions, because a box can be wrong two ways.
         *
         * This pass only ever shortened, which is why nothing noticed that the
         * writer was filling a quarter of every content box: copy that is too
         * thin passes a fit check perfectly. Expanding is the more dangerous
         * half — a model asked for more words will invent facts to produce
         * them — so the instruction is explicit that the extra length comes
         * from developing what the slide already says, and from the deck's own
         * material, never from anywhere else.
         */
        const rewriteSystem = "You are rewriting presentation copy to fit a fixed layout. Preserve the meaning and the facts exactly. Where copy is too long, shorten it by removing unnecessary words, simplifying sentences and dropping duplicated ideas — in that order. Where copy is too short, develop what is already there: explain the mechanism, add the consequence, name the concrete case that the slide's own subject supplies. Never invent a fact, a number, a name or a date to fill space, never change a number, and never mention the layout. Return only the required schema.";
        const rewritePrompt = `Quyidagi matnlar dizayndagi qutilarga mos kelmadi.\n`
          + `"too long" bo'lsa — ma'noni saqlab qisqartiring.\n`
          + `"too short" yoki "empty" bo'lsa — "about" dagi mavzu va sarlavhaga tayanib yozing: `
          + `sabab, mexanizm, natija yoki aniq misol qo'shing. `
          + `Yangi fakt, raqam, ism yoki sana O'YLAB TOPMANG.\n`
          + `Har bir maydon uchun "aimCharacters" atrofida yozing, "maxCharacters" dan oshmang.\n`
          + `"last line is a single short word" bo'lsa, qator ajratishni o'zgartiring yoki qisqartiring.\n\n${JSON.stringify(request)}`;
        const rewritten = await writer.structured<{ slides: { slide: number; fields: { field: string; text: string }[] }[] }>({
          prompt: `${rewriteSystem}\n\n${rewritePrompt}`,
          system: rewriteSystem,
          schemaName: "content_rewrite",
          schema: rewriteSchema(),
          maxOutputTokens: 4_000,
        });

        rewrites += 1;
        rewriteAttribution = {
          provider: rewritten.provider, model: rewritten.model,
          attempts: rewriteAttribution.attempts + rewritten.attempts,
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
        return failing.length;
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await fitPass() === 0) break;
      }

      /**
       * Still too long after two rewrites: move the slide, not the type.
       *
       * Asking a third time either returns the same sentence or starts deleting
       * the fact the slide existed to state. The alternative used to be the
       * renderer shrinking the type, which is how one slide ends up set four
       * points smaller than its neighbours for a reason no reader can see. A
       * family has other pages and some of them are bigger.
       */
      const stillWritten = new Map<number, SemanticSlide>();
      layoutPlan.slides.forEach((planned) => {
        const written = writtenSlides[planned.index];
        const outlineSlide = outlineResult.data.slides[planned.index];
        if (!written) return;
        stillWritten.set(planned.index, {
          ...written,
          title: outlineSlide?.title ?? "",
          purpose: outlineSlide?.purpose ?? "",
          layout: planned.layout,
        } as never);
      });

      const moved = reseatOverflowing(jslayd.document, layoutPlan, stillWritten, {
        ...(jslayd.profiles ? { profiles: jslayd.profiles } : {}),
      });
      /**
       * What is still wrong when the loop gives up, recorded where it can be
       * read afterwards.
       *
       * A rewrite that does not converge and a reseat that does not help both
       * end here silently, and the deck goes out with copy that overflows its
       * box. The stage row is the one place an operator — or a test — can see
       * it without the edge logs.
       */
      /**
       * The move changed the boxes, so measure again.
       *
       * `reseatOverflowing` picks a bigger composition for copy that would not
       * fit the old one — but a bigger page can draw a paragraph where the old
       * one drew a list, and the merged paragraph is longer than any of the
       * lines that made it. Two passes here, and what survives them is what the
       * stage row reports.
       */
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await fitPass() === 0) break;
      }

      /**
       * The last resort, and it is not the type size.
       *
       * Two rewrites and a reseat still leave the occasional paragraph over
       * its box: a model asked to shorten sometimes returns the same sentence,
       * and on a bad topic it does that twice. Shipping it means copy running
       * off the slide, and the alternative the renderer used to reach for —
       * smaller type — is what made one slide four points different from its
       * neighbours for a reason no reader can see.
       *
       * So the text is cut, at a sentence boundary where there is one. A
       * paragraph one sentence shorter is a composition the design already
       * draws; text past the edge of the box is not.
       */
      layoutPlan.slides.forEach((planned) => {
        const brief = briefFor(planned.archetypeId);
        const written = writtenSlides[planned.index];
        if (!brief || !written) return;
        for (const problem of findSlotProblems(brief, { ...written, title: "", purpose: "", layout: planned.layout } as never)) {
          if (problem.overBy <= 0 || problem.binding === "title") continue;
          const limit = problem.maximumCharacters;
          const sentences = problem.text.split(/(?<=[.!?…])\s+/);
          let kept = "";
          for (const sentence of sentences) {
            const next = kept ? `${kept} ${sentence}` : sentence;
            if (next.length > limit) break;
            kept = next;
          }
          if (!kept) {
            const cut = problem.text.slice(0, limit);
            const boundary = cut.lastIndexOf(" ");
            kept = (boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd();
          }
          if (kept && kept.length < problem.text.length) {
            writtenSlides[planned.index] = applyRewrite(
              writtenSlides[planned.index] as never,
              problem.binding,
              kept,
            ) as never;
            console.log(JSON.stringify({
              event: "slot_trimmed",
              job_id: input.jobId,
              slide: planned.index,
              binding: problem.binding,
              from: problem.text.length,
              to: kept.length,
            }));
          }
        }
      });

      const unresolved: string[] = [];
      layoutPlan.slides.forEach((planned) => {
        const brief = briefFor(planned.archetypeId);
        const current = writtenSlides[planned.index];
        const written = current
          ? { ...stillWritten.get(planned.index), ...current } as SemanticSlide
          : stillWritten.get(planned.index);
        if (!brief || !written) return;
        for (const problem of findSlotProblems(brief, written as never)) {
          if (problem.overBy > 0) unresolved.push(`${planned.index}:${problem.binding}+${problem.overBy}`);
        }
      });
      if (unresolved.length > 0) {
        fitReport = ` · sig'madi: ${unresolved.join(", ")}`;
        console.log(JSON.stringify({ event: "slots_still_overflowing", job_id: input.jobId, slots: unresolved }));
      }

      if (moved.reseats.length > 0) {
        // `layoutPlan.slides` is what the renderer is handed, so the move takes
        // effect by having happened; the briefs are refreshed because a later
        // reader of this map would otherwise measure the old composition.
        for (const brief of moved.briefs) briefById.set(brief.archetypeId, brief);
        console.log(JSON.stringify({
          event: "slide_reseated",
          job_id: input.jobId,
          moves: moved.reseats,
        }));
      }
    }

    /**
     * Alternate the chart shapes before the deck is assembled.
     *
     * After every rewrite, so a slide reseated or re-written late is included,
     * and before `assembleDeck`, which is the last point anything may change
     * what a slide says.
     */
    const diversified = diversifyChartTypes(writtenSlides as never) as typeof writtenSlides;
    for (let at = 0; at < writtenSlides.length; at += 1) writtenSlides[at] = diversified[at]!;

    if (!deckHasVisualStatistic(writtenSlides)) {
      throw new Error("Taqdimot uchun majburiy bar yoki doira diagrammasi yaratilmagan.");
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
      () => `«${jslayd.document.design.name}» dizayni (v${jslayd.version}) qo‘llandi${fitReport}`,
    );
    const pricing = await providerPricing(input.service);

    /**
     * One row per stage, priced against the model that actually ran it.
     *
     * Research and writing can be pointed at different Gemini models by
     * configuration, so the cost is looked up per row rather than once per job:
     * a table that prices every stage at the writing model's rate is wrong the
     * moment somebody sets `GEMINI_RESEARCH_MODEL` to something else.
     */
    const stages: { operation: string; answer: { usage: { input_tokens?: number; output_tokens?: number }; requestId: string | null; provider: string; model: string; attempts: number; groundedSearch?: boolean } }[] = [
      { operation: "topic_research", answer: research },
      { operation: "presentation_outline", answer: outlineResult },

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
    /**
     * A row per slide, because a slide is what was asked for.
     *
     * The deck-level row says what the writing stage cost in total; these say
     * where it went. A deck that cost twice what it should did so on one slide,
     * and a sum cannot name it.
     */
    const slideRows = (contentResult.entries ?? []).map((entry) => {
      const planned = layoutPlan.slides.find((slide) => slide.index === entry.index);
      const cost = usageCost(entry.usage, pricing.for(writer.writingModel));
      totalCost += cost;
      return {
        owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId,
        provider: "google", model: writer.writingModel, operation: "presentation_slide_write",
        input_tokens: entry.usage.input_tokens ?? 0,
        output_tokens: entry.usage.output_tokens ?? 0,
        provider_cost_usd: cost, request_id: null,
        metadata: {
          slide_index: entry.index,
          archetype_id: planned?.archetypeId ?? null,
          attempts: entry.attempts,
        },
      };
    });

    if (mode === "real") await input.service.from("ai_usage").insert([...rows, ...slideRows]);

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

    /**
     * Bounded, because this stage is a loop of network calls.
     *
     * Each search and each download gives up on its own, but a deck with a
     * dozen picture slots multiplies those limits together, and the sum can
     * outlast the wall clock the worker is given. Being killed mid-stage leaves
     * the job at `running` for ever with the author's credits reserved; giving
     * up here leaves a deck with fewer pictures, which every design already
     * handles. Two minutes is well inside the platform's limit and well outside
     * a healthy run, which finishes this stage in under forty seconds.
     */
    const generatedImages = await withDeadline(runStage(input.service, input, "generating_images", async () => {
      if (prepared.presentation.style !== "super_professional" || mode === "mock") return [] as GeneratedImage[];
      /**
       * A template deck used to bring its own photographs and nothing else.
       *
       * That was true while the exporter could only replace text: a picture
       * fetched here would have been found, stored, credited and charged for,
       * and then dropped on the way out. The cloner can swap the bytes behind a
       * picture now, so the same stock cover no longer appears on every
       * customer's deck about a different subject.
       *
       * The picture the template ships stays where nothing better is found, and
       * a page whose only pictures are logos is left alone entirely — those
       * decisions are the exporter's, because it is the one holding the package
       * and can see how big each picture is and what shape.
       */
      /**
       * How much photography a design wants, read from the design.
       *
       * An archetype that supports an image is a slide with somewhere to put
       * one. A design whose slides are all type gets no pictures rather than
       * pictures it will drop.
       */
      /**
       * How much photography a design wants, read from the design.
       *
       * For a written design that is `supportsImage`: an archetype with a hole
       * in it. For a template it cannot be — a template's pictures are its own,
       * so every slot is marked filled and the flag is false on almost every
       * page. What counts there is whether the page draws a picture at all,
       * because that picture is now the thing that can be replaced.
       */
      const imageArchetypes = isTemplate
        ? jslayd.document.archetypes.filter((archetype) =>
          archetype.elements.some((element) => element.type === "image" || element.type === "frame")).length
        : jslayd.document.archetypes.filter((archetype) => archetype.selection.supportsImage).length;
      const policy = imageArchetypes === 0
        ? "none"
        : imageArchetypes <= 2
          ? "cover"
          : imageArchetypes <= 4 ? "contextual" : "all";
      if (policy === "none") return [] as GeneratedImage[];

      /**
       * Which archetype each slide will actually be laid out in.
       *
       * `archetypesInOrder` is indexed off `layoutPlan`, which covers the
       * written body — the cover and the agenda sit in front of it and are laid
       * out by the design's own choice, so both read back undefined. A page
       * whose archetype cannot be seen here is a page whose picture slot cannot
       * be seen either, and an unfilled slot draws an empty frame: a grey
       * rectangle on the first two pages of the deck.
       */
      const byPurpose = (purpose: string) => jslayd.document.archetypes.find((entry) => entry.purpose === purpose);
      const archetypeAt = (index: number) => archetypesInOrder[index]
        ?? (index === 0 ? byPurpose("cover") ?? jslayd.document.archetypes[0] : undefined)
        ?? (index === 1 ? byPurpose("agenda") : undefined);

      /**
       * The two pages whose layout is not settled yet.
       *
       * `archetypesInOrder` covers the written body. The cover and the agenda
       * are chosen later, inside the layout step, because that choice depends
       * on which pictures were found — and the pictures are found here. The
       * circle is real and not worth breaking for this.
       *
       * So for a template, where nearly every page carries a stock photograph
       * somebody else chose, an unresolved prefix page is assumed to want one.
       * The cost of being wrong is a search nothing uses; the cost of not
       * asking is the template's own picture on the second page of every deck,
       * which is what an author noticed.
       */
      const unresolvedPrefix = (index: number) => isTemplate && index < DECK_PREFIX && !archetypeAt(index);

      /**
       * A page this deck can put a picture on.
       *
       * For a written design that means an *empty* slot: its own artwork is
       * part of the composition and replacing it would fight the design.
       *
       * For a template it is the opposite. Every picture a template has is its
       * own — a stock photograph chosen for somebody else's subject — and those
       * are exactly the ones worth replacing. Asking for empty slots there
       * found none, which is why a six-page template deck came back with one
       * picture changed out of six.
       */
      const wantsPicture = (index: number) => (archetypeAt(index)?.elements ?? []).some((element) => {
        if (element.type !== "image" && element.type !== "frame") return false;
        const owned = Boolean(element.source && "asset" in element.source);
        return isTemplate ? true : !owned;
      });

      // A slide whose every visual slot is a library element needs no
      // photograph: the object is the picture.
      const indexed = plan.slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ index }) => !elementCovered.has(index));

      /**
       * A template page is chosen by whether it draws a picture, not by whether
       * the writer described one.
       *
       * The other policies require a `visualPrompt`, which is written for a
       * design that has an empty hole to fill. A template has no hole — it has
       * a photograph already — so nothing asks the model to describe one, and
       * requiring it here meant no template page was ever a candidate. What
       * decides instead is the page itself: if it draws a picture, that picture
       * can be replaced, and the slide's own title says what with.
       *
       * The cover is included, because a template's cover carries the most
       * generic stock photograph in the deck and is the one worth replacing
       * most.
       */
      const targets = isTemplate
        // Every page that draws a picture, capped so a long deck does not spend
        // a search on each of thirty pages.
        ? indexed
          .filter(({ index }) => wantsPicture(index) || unresolvedPrefix(index))
          .slice(0, Math.ceil(plan.slides.length * 0.7))
        : policy === "cover"
        ? indexed.filter(({ index }) => index === 0)
        // `contextual` always dresses the opening slide and always leaves the
        // second one on the palette ground, so the deck opens with contrast.
        : policy === "contextual"
          ? indexed.filter(({ slide, index }) => index === 0 || (index > 1 && Boolean(slide.visualPrompt))).slice(0, Math.ceil(plan.slides.length * 0.5))
          : indexed
            /**
             * The cover counts when it has a hole in it.
             *
             * `all` excluded index 0 because a cover is usually type on a
             * colour and dressing it would fight the design. But a design whose
             * cover *declares* an image slot has already decided otherwise, and
             * skipping it left an empty picture frame on the first page of the
             * deck — the first thing anybody sees.
             *
             * The cover has no `visualPrompt` either: nothing writes one for a
             * page the outline does not describe. Its own title is the subject.
             */
            .filter(({ slide, index }) => (index > 0 && Boolean(slide.visualPrompt))
              // Or any page holding an empty picture slot, wherever it sits.
              // A frame the design left for the deck is a frame the deck has to
              // fill; leaving it draws a grey rectangle the author cannot
              // remove.
              || wantsPicture(index))
            .slice(0, Math.ceil(plan.slides.length * 0.6));

      const results: GeneratedImage[] = [];
      /** Subjects this deck has already put a picture of on a slide. */
      const illustrated = new Set<string>();
      /** Why the slides without one have none, counted by reason. */
      const refusals = new Map<string, number>();
      for (const target of targets) {
        /**
         * What the design asked for, where the design said.
         *
         * A slot declares the shape it wants a picture to be and the register
         * it wants it in; searching without them returns a landscape photograph
         * for a portrait hole and a stock-looking one for an editorial page.
         * The archetype chosen for this slide is already known here, so there
         * is nothing to guess.
         */
        const slot = archetypesInOrder[target.index]?.elements
          .find((element) => element.type === "image" || element.type === "frame") as
          { orientation?: "landscape" | "portrait" | "square" | "any"; stylePreference?: string | null } | undefined;

        /**
         * An illustration where the library has one, a photograph otherwise.
         *
         * Which is right depends on the subject rather than on the design: a
         * metro station wants a photograph and "strategiya" wants a diagram,
         * and no photo index has a good answer for the second. The library is
         * asked first and its answer settles it — it either holds something for
         * this subject or it does not, which is a fact rather than a guess.
         *
         * Only for template pages. A written design already decides this for
         * itself: its slots say `strategy: jelement` where an object belongs,
         * and those slides are excluded from this loop entirely.
         */
        if (isTemplate) {
          const drawn = await findIllustration(input.service, {
            query: (target.slide.visualPrompt ?? target.slide.title ?? "").trim(),
            slideRole: archetypesInOrder[target.index]?.purpose ?? "title_content",
          });
          if (drawn) {
            results.push({
              slideIndex: target.index, bucket: drawn.bucket, path: drawn.path,
              provider: "jelement", costUsd: 0,
            });
            const noted = await input.service.from("presentation_assets").insert({
              presentation_id: input.presentationId,
              owner_id: input.ownerId,
              kind: "stock",
              storage_bucket: drawn.bucket,
              storage_path: drawn.path,
              mime_type: "image/png",
              provider: "jelement",
              metadata: {
                slide_index: target.index,
                source: "jelement",
                // The library's own object, so there is no third party to
                // credit — but what was used is still recorded, because a deck
                // nobody can explain later is a deck nobody can fix.
                attribution: { title: drawn.name, creator: "JAXONGIR AI", license: "internal", licenseUrl: "", sourceUrl: "", provider: "jelement" },
              },
            });
            if (noted.error) console.error("illustration not recorded", input.presentationId, target.index, noted.error.message);
            continue;
          }
        }

        const photo = await findPhoto(input.service, {
          ownerId: input.ownerId,
          presentationId: input.presentationId,
          slideIndex: target.index,
          direction: target.slide.visualPrompt ?? plan.visualDna.imageDirection,
          topic: prepared.presentation.topic,
          // The slide's own title names the subject; the direction describes
          // the scene. The resolver reads both.
          title: target.slide.title ?? null,
          orientation: slot?.orientation ?? "landscape",
          stylePreference: slot?.stylePreference ?? null,
          imageSlot: (slot as { slot?: string } | undefined)?.slot ?? null,
          // One subject, one picture per deck: six slides about one person
          // should not be the same photograph six times.
          used: illustrated,
          report: (reason) => refusals.set(reason, (refusals.get(reason) ?? 0) + 1),
        });
        // No photograph is a slide on the palette ground, which several designs
        // treat as a deliberate composition. It is never a reason to stop.
        if (!photo) continue;

        if (photo.entity) illustrated.add(photo.entity);
        results.push({
          slideIndex: photo.slideIndex, bucket: photo.bucket, path: photo.path,
          // Which index answered, not which site hosts the file. Openverse
          // reports the upstream host — "flickr", "wikimedia" — so recording
          // that alone leaves no way to tell the two searches apart.
          provider: photo.source, costUsd: 0,
        });

        /**
         * The licence and the author travel with the file.
         *
         * An openly licensed photograph has to be credited and provenance that
         * was not stored cannot be recovered from the file later. The result is
         * read rather than discarded: this insert failed for a year against an
         * enum with no `stock` in it, and because nothing looked, every deck
         * kept its pictures and lost every credit line silently.
         */
        const credited = await input.service.from("presentation_assets").insert({
          presentation_id: input.presentationId,
          owner_id: input.ownerId,
          kind: "stock",
          storage_bucket: photo.bucket,
          storage_path: photo.path,
          mime_type: "image/jpeg",
          provider: photo.source,
          metadata: {
            slide_index: target.index,
            source: photo.source,
            // What the resolver decided this picture is of. A deck whose
            // pictures cannot be traced back to a subject cannot be audited
            // later for the one failure that matters: the wrong person.
            subject: photo.entity ?? null,
            // Which service found it. The provider says which index answered;
            // this says which door the question went through.
            resolved_via: photo.via ?? null,
            attribution: photo.attribution,
            // The picture's own shape, so the exporter can choose which frame
            // it belongs in without downloading it twice to find out.
            width: photo.width,
            height: photo.height,
            // Kept so a credit can be checked against the place it came from,
            // and so a deck's pictures can be audited long after the search.
            query: { orientation: slot?.orientation ?? "landscape", stylePreference: slot?.stylePreference ?? null },
          },
        });
        // Loud, and not fatal: the deck keeps the picture, and the operator
        // learns the credit is missing while there is still something to fix.
        if (credited.error) {
          console.error("stock attribution not stored", input.presentationId, target.index, credited.error.message);
        }
      }
      if (refusals.size > 0) {
        console.log(JSON.stringify({
          event: "image_refusals",
          presentation_id: input.presentationId,
          refusals: Object.fromEntries(refusals),
        }));
      }
      return Object.assign(results, { refusals: [...refusals].map(([reason, count]) => `${reason}: ${count}`).join(", ") });
    }, (value) => {
      const why = (value as GeneratedImage[] & { refusals?: string }).refusals;
      if (!value.length) return why ? `Rasm topilmadi (${why})` : "Ushbu dizayn uchun foto talab qilinmadi";
      // Named in the progress line, because "8 photos found" does not say
      // whether the better index answered or the fallback carried the deck.
      const counted = value.reduce<Record<string, number>>((tally, image) => {
        tally[image.provider] = (tally[image.provider] ?? 0) + 1;
        return tally;
      }, {});
      const where = Object.entries(counted).map(([name, count]) => `${name}: ${count}`).join(", ");
      return `${value.length} ta litsenziyalangan foto topildi (${where})${why ? ` · ${why}` : ""}`;
    }), 120_000, "generating_images");

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
        /**
         * What each template box will say, for the slides the model wrote.
         *
         * Offset the same way the archetypes are: `assembleDeck` puts the cover
         * and the agenda in front of the written body, so planned slide `i` is
         * deck slide `i + 2`.
         */
        ...(isTemplate
          ? {
            templateText: plan.slides.map((_, position) =>
              templateText.get(position - DECK_PREFIX) ?? null),
          }
          : {}),
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
      const visibleChart = rows.elements.some((element) => {
        if (element.type !== "chart") return false;
        const content = element.content as { chartType?: unknown; labels?: unknown; values?: unknown } | null;
        return isVisualStatistic({
          type: content?.chartType,
          labels: content?.labels,
          values: content?.values,
        });
      });
      if (!visibleChart) {
        // No ready deck can export a chartless PPTX. Designs that cannot draw
        // the required visual fail here rather than silently dropping data.
        throw new Error("Tanlangan dizayn majburiy vizual statistikani ko‘rsata olmadi.");
      }
      const deleteResult = await input.service.from("slides").delete().eq("presentation_id", input.presentationId);
      if (deleteResult.error) throw deleteResult.error;
      const slideInsert = await input.service.from("slides").insert(rows.slides);
      if (slideInsert.error) throw slideInsert.error;
      const elementInsert = await input.service.from("slide_elements").insert(rows.elements);
      if (elementInsert.error) throw elementInsert.error;
      return rows;
    }, (value) => `${value.slides.length} ta slayd va ${value.elements.length} ta tahrirlanadigan element saqlandi`);

    /**
     * Which slide, and which hole in it, each picture actually landed in.
     *
     * Pictures are found before the slides exist, because the layout depends on
     * what was found — so an asset row can only be written with a slide index
     * and no way to say more. The elements know the rest: every image element
     * carries the slot it fills and the path it draws.
     *
     * Read back off what was written rather than predicted from the archetype.
     * A picture the renderer declined to place — too small a frame, a slot the
     * substituted composition does not have — would otherwise be recorded as
     * placed somewhere it is not, and a credit line pointing at the wrong slide
     * is worse than one pointing nowhere.
     */
    if (generatedImages.length > 0) {
      const placed = new Map<string, { slideId: string; slot: string }>();
      for (const element of built.elements) {
        const content = element.content as { storagePath?: unknown; slot?: unknown } | null;
        const path = typeof content?.storagePath === "string" ? content.storagePath : null;
        const slot = typeof content?.slot === "string" ? content.slot : null;
        if (!path || !slot || placed.has(path)) continue;
        placed.set(path, { slideId: element.slide_id, slot });
      }

      const stored = await input.service.from("presentation_assets")
        .select("id,storage_path,metadata")
        .eq("presentation_id", input.presentationId)
        .in("storage_path", [...placed.keys()]);

      for (const row of stored.data ?? []) {
        const where = placed.get(row.storage_path as string);
        if (!where) continue;
        const bound = await input.service.from("presentation_assets").update({
          metadata: { ...(row.metadata as Record<string, unknown> ?? {}), slide_id: where.slideId, image_slot: where.slot },
        }).eq("id", row.id);
        // Not fatal. The picture is on the slide either way; what is lost is
        // the ability to say which slot it is in, and that is worth a line in
        // the log rather than a failed deck.
        if (bound.error) console.error("picture binding not recorded", input.presentationId, row.storage_path, bound.error.message);
        else {
          console.log(JSON.stringify({
            event: "image_bound_to_slot",
            presentation_id: input.presentationId,
            slide_id: where.slideId,
            image_slot: where.slot,
          }));
        }
      }
    }

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

    /**
     * The spoken script, started once the deck is somebody's.
     *
     * After the deck is marked ready and never before it: a script that fails
     * must not cost a person the deck it was written for. Nothing here waits
     * for it or reads its answer — the app finds it when somebody opens
     * "Himoya matni", and offers to write one if it is not there yet.
     *
     * Its own function rather than a stage, so its cost, its failures and its
     * retries are separate from the deck's.
     */
    void writeDefenseScript(input).catch((failure) => {
      console.error(JSON.stringify({
        event: "presentation_defense_not_started",
        job_id: input.jobId,
        presentation_id: input.presentationId,
        detail: String((failure as Error)?.message ?? failure).slice(0, 200),
      }));
    });
  } catch (error) {
    /**
     * The author is told what they can act on, and nothing else.
     *
     * A provider's own sentence used to be written straight into the job and
     * shown on the phone, which is how "You have no credits remaining — add to
     * your billing" ended up on a paying customer's screen. The full text still
     * exists, in the server log, where the person who can act on it will look.
     */
    const { code, message } = userFacingFailure(error);
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 600);
    console.error(JSON.stringify({ event: "generation_failed", job_id: input.jobId, code, detail }));

    /**
     * What the provider actually said, kept where it can be read later.
     *
     * The author gets one sanitised sentence, which is right — a vendor's
     * message about our request is not theirs to act on. But it went only to
     * the Edge log, and a `console.error` on somebody else's infrastructure is
     * not somewhere you can query. Twice now a deck has failed with a code and
     * no cause, and both times finding out meant guessing and redeploying.
     *
     * A failed call is still a call, so it belongs in the table that records
     * calls. Zero tokens and zero cost, because nothing was produced; the
     * metadata carries the reason. Written best-effort: a failure to record a
     * failure must not replace it.
     */
    try {
      await input.service.from("ai_usage").insert({
        owner_id: input.ownerId,
        presentation_id: input.presentationId,
        job_id: input.jobId,
        provider: "google",
        model: writer.writingModel,
        operation: "generation_failed",
        input_tokens: 0,
        output_tokens: 0,
        provider_cost_usd: 0,
        metadata: { code, detail },
      });
    } catch (recordFailure) {
      console.error("could not record the failure", String(recordFailure).slice(0, 200));
    }

    await input.service.rpc("fail_generation", {
      p_job_id: input.jobId, p_error_code: code, p_error_message: message,
    });
  }
}

/* ------------------------------------------------- the generative engine */

/**
 * A deck composed page by page, and the stages that report it.
 *
 * The same stage keys as the JSLAYD path, because the phone draws a progress
 * bar from them and an author watching it should not be able to tell which
 * engine is running from the labels. What differs is what happens inside:
 * there is no layout to choose, no archetype to fit copy into and no template
 * to clone.
 */
async function runGenerative(params: {
  input: PipelineInput;
  writer: ReturnType<typeof geminiWriter>;
  presentation: { topic: string; style: string; requested_slide_count: number; author_name: string | null; teacher_name: string | null };
  outline: Outline;
  research: string;
  addCost: (amount: number) => void;
  pricing: { for(model: string): { inputPerMillion: number; outputPerMillion: number } };
}): Promise<void> {
  const { input, presentation, outline } = params;

  const composed = await withDeadline(
    runStage(input.service, input, "writing_content", async () => {
      return await composeGenerativeDeck({
        service: input.service,
        writer: params.writer,
        ownerId: input.ownerId,
        presentationId: input.presentationId,
        topic: presentation.topic,
        author: presentation.author_name,
        teacher: presentation.teacher_name,
        slides: deckPagesFrom({
          topic: presentation.topic,
          outlineTitles: outline.slides.map((slide) => slide.title),
          research: params.research || null,
          agendaTitle: AGENDA_TITLE,
          referencesTitle: REFERENCES_TITLE,
          thanksTitle: THANKS_TITLE,
        }),
        onUsage: (usage, model) => {
          const price = params.pricing.for(model);
          params.addCost(usageCost(usage, price));
        },
        /**
         * A heartbeat per slide, so the watchdog can tell a long run from a
         * dead one. Composing a page takes seconds and a deck takes minutes;
         * without this the job looks stalled halfway through.
         */
        beat: (note) => {
          console.log(JSON.stringify({ event: "scene_progress", job_id: input.jobId, note }));
          void input.service.from("generation_jobs")
            .update({ heartbeat_at: new Date().toISOString() }).eq("id", input.jobId);
        },
      });
    }, (value) => `${value.deck.slides.length} ta slayd noldan dizayn qilindi`),
    280_000,
    "writing_content",
  );

  /**
   * Pictures are already found and stored by the time the scenes exist, so the
   * image stage has nothing left to do but say what happened.
   */
  await runStage(input.service, input, "generating_images", async () => {
    const drawn = composed.deck.slides.reduce((total, slide) =>
      total + (slide.rendered?.elements.filter((row) => row.type === "image").length ?? 0), 0);
    return drawn;
  }, (value) => value > 0 ? `${value} ta rasm kompozitsiyaga joylashtirildi` : "Ushbu deck uchun rasm talab qilinmadi");

  await runStage(input.service, input, "building_layouts", async () => composed.deck.slides,
    (value) => `${value.length} ta kompozitsiya qurildi`);

  const built = await runStage(input.service, input, "building_slides", async () => {
    const cleared = await input.service.from("slides").delete().eq("presentation_id", input.presentationId);
    if (cleared.error) throw cleared.error;
    const slides = await input.service.from("slides").insert(composed.slideRows);
    if (slides.error) throw slides.error;
    const elements = await input.service.from("slide_elements").insert(composed.elementRows);
    if (elements.error) throw elements.error;
    return composed;
  }, (value) => `${value.slideRows.length} ta slayd va ${value.elementRows.length} ta tahrirlanadigan element saqlandi`);

  await runStage(input.service, input, "quality_checking", async () => {
    const scores = composed.deck.observability.scores;
    /**
     * A page the engine had to build from the brief is not a failed deck, but
     * a deck made mostly of them is. Half is the line: below it the model is
     * not designing, and shipping that quietly would hide the fact.
     */
    const designed = composed.deck.slides.filter((slide) => !slide.synthesised).length;
    if (designed * 2 < composed.deck.slides.length) {
      throw new Error("Dizayn engine slaydlarning yarmidan ko‘pini qura olmadi.");
    }
    return scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
  }, (value) => `O‘rtacha sifat bahosi ${Math.round(value)}/100`);

  await runStage(input.service, input, "finalizing", async () => {
    const { data: styleConfig, error: styleError } = await input.service
      .from("style_configs")
      .select("base_credits,credits_per_slide,credits_per_image")
      .eq("style", presentation.style as PresentationStyle)
      .single();
    if (styleError) throw styleError;
    const pictures = composed.deck.slides.reduce((total, slide) =>
      total + (slide.rendered?.elements.filter((row) => row.type === "image").length ?? 0), 0);
    const actualCredits = Math.ceil(
      styleConfig.base_credits
      + presentation.requested_slide_count * Number(styleConfig.credits_per_slide)
      + pictures * styleConfig.credits_per_image,
    );

    const updated = await input.service.from("presentations").update({
      generated_slide_count: composed.slideRows.length,
      // Which engine, and the language it was made in — so a deck can be
      // explained, and re-rendered, long after the run.
      design_engine: composed.deck.engine,
      design_dna: {
        direction: composed.deck.dna.direction,
        fonts: composed.deck.dna.fonts,
        colors: composed.deck.dna.colors,
        radius: composed.deck.dna.radius,
      },
      // Left alone deliberately: no JSLAYD design was used, so pinning one
      // would say something untrue about how this deck was made.
      design_id: null,
      design_version: null,
    }).eq("id", input.presentationId);
    if (updated.error) throw updated.error;

    const { error } = await input.service.rpc("settle_generation", {
      p_job_id: input.jobId,
      p_actual_credits: actualCredits,
      p_provider_cost_usd: 0,
    });
    if (error) throw error;
    return actualCredits;
  }, (value) => `${value} kredit bo‘yicha hisob yakunlandi`);

  await input.service.from("generation_steps").update({
    status: "succeeded",
    progress: 100,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    message: "Taqdimot tayyor",
  }).eq("job_id", input.jobId).eq("key", "ready");

  console.log(JSON.stringify({
    event: "generative_deck_finished",
    job_id: input.jobId,
    engine: composed.deck.engine,
    scores: composed.deck.observability.scores,
    repairs: composed.deck.observability.repairCount,
    synthesised: composed.deck.observability.synthesisedSlides.length,
    mirrored: composed.deck.observability.mirroredSlides.length,
    asks: composed.deck.observability.askCount,
  }));

  void writeDefenseScript(input).catch(() => { /* the deck is already somebody's */ });
}
