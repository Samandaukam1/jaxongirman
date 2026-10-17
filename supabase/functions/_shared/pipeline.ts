import { facesFor, isDeckLanguage, RESEARCH_IN, type DeckLanguage } from "./glass/language.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { geminiWriter } from "./gemini.ts";
import { attributionMetadata, ProviderUnavailable, userFacingFailure, type Attachment } from "./writer.ts";
import type { PresentationStyle } from "./presentation-types.ts";
import { resolveCitations } from "./glass/sources.ts";
import { composeGlassDeck, deckSources, findPictures, glassRows, inventDesign, libraryFaces, notesSources, pictureWishes, writeOutline, writeSlides, type Call } from "./glass-engine.ts";
import type { Picture } from "./glass/compose.ts";
import { placeSourceImages, readOutline, readSlide, type SourceImage } from "./glass/content.ts";
import { readDesignRequest, type DeckStyle } from "./glass/dna.ts";

/** How each style is named to the author, in the generation steps. */
const STYLE_NAMES: Record<DeckStyle, string> = { glass: "Liquid Glass", editorial: "jurnal uslubi", soft3d: "Soft 3D", corporate: "korporativ uslub", naqsh: "milliy naqsh uslubi", spektr: "Spektr infografika uslubi", mozaika: "Mozaika geometrik uslubi" };

type PipelineInput = { jobId: string; presentationId: string; ownerId: string; service: SupabaseClient };

/** Cover, agenda, bibliography and closing — assembled here, never by the model. */
const SPECIAL_SLIDES = 4;
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
type UploadAsset = {
  storage_bucket?: string | null; storage_path?: string | null; mime_type?: string | null; byte_size?: number | null;
  alt_text?: string | null; metadata?: unknown;
};

/** An author's picture that was read, under the key its page will ask for. */
type LoadedImage = SourceImage & { bucket: string; path: string };

/** The position of an author's picture (1–6), or null for any other upload. */
function slideImageIndex(asset: UploadAsset): number | null {
  const metadata = asset.metadata as { role?: unknown; index?: unknown } | null;
  return metadata?.role === "slide_image" && typeof metadata.index === "number" ? metadata.index : null;
}

async function readAttachments(
  service: SupabaseClient,
  assets: UploadAsset[],
): Promise<{ attachments: Attachment[]; images: LoadedImage[] }> {
  const attachments: Attachment[] = [];
  const images: LoadedImage[] = [];
  let budget = ATTACHMENT_BUDGET;

  // The author's pictures first and in their order: the outline names them by
  // that order, and each is a few hundred kilobytes, so documents still fit.
  const ordered = [
    ...assets.filter((asset) => slideImageIndex(asset) !== null).sort((a, b) => slideImageIndex(a)! - slideImageIndex(b)!),
    ...assets.filter((asset) => slideImageIndex(asset) === null),
  ];

  for (const asset of ordered.slice(0, 11)) {
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

    const index = slideImageIndex(asset);
    if (index !== null && asset.storage_bucket) {
      images.push({
        key: `user-image-${index}`,
        caption: (asset.alt_text ?? "").trim().slice(0, 300),
        bucket: asset.storage_bucket,
        path: asset.storage_path,
      });
    }
  }

  return { attachments, images };
}

/**
 * The author's pictures no page ended up showing, removed as soon as the deck
 * is built.
 *
 * A picture lives exactly as long as the deck that shows it; one the deck does
 * not show has no reason to stay in storage. Never fatal — at worst the folder
 * keeps it until the deck itself is deleted.
 */
async function dropUnusedImages(
  input: PipelineInput,
  images: readonly LoadedImage[],
  elementRows: readonly Record<string, unknown>[],
): Promise<void> {
  if (!images.length) return;
  const shown = new Set<string>();
  for (const row of elementRows) {
    const path = (row.content as { storagePath?: unknown } | null)?.storagePath;
    if (typeof path === "string") shown.add(path);
  }
  const unused = images.filter((image) => !shown.has(image.path));
  if (!unused.length) return;
  try {
    const paths = unused.map((image) => image.path);
    const removed = await input.service.storage.from(unused[0]!.bucket).remove(paths);
    if (removed.error) throw removed.error;
    await input.service.from("presentation_assets").delete()
      .eq("presentation_id", input.presentationId).in("storage_path", paths);
  } catch (failure) {
    console.error(JSON.stringify({ event: "source_images_not_dropped", job_id: input.jobId, detail: String((failure as Error)?.message ?? failure).slice(0, 200) }));
  }
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
      const [presentationResult, sourcesResult, assetsResult, jobResult] = await Promise.all([
        input.service.from("presentations").select("*").eq("id", input.presentationId).eq("owner_id", input.ownerId).single(),
        input.service.from("presentation_sources").select("label").eq("presentation_id", input.presentationId).order("position"),
        input.service.from("presentation_assets").select("*").eq("presentation_id", input.presentationId).eq("kind", "upload"),
        input.service.from("generation_jobs").select("context").eq("id", input.jobId).maybeSingle(),
      ]);
      if (presentationResult.error) throw presentationResult.error;
      if (sourcesResult.error) throw sourcesResult.error;
      if (assetsResult.error) throw assetsResult.error;
      // The author's design choice rides on the job as well as the deck: the
      // deck's column is held to a list of styles by a constraint, and a style
      // newer than that list was refused there — which used to turn the choice
      // silently into "automatic". The job's copy has no such list.
      const jobContext = (jobResult.data?.context ?? {}) as { design?: unknown };
      const request = readDesignRequest(presentationResult.data.design_request) ?? readDesignRequest(jobContext.design);
      return {
        presentation: { ...presentationResult.data, design_request: request },
        sources: sourcesResult.data.map((row) => row.label),
        assets: assetsResult.data,
      };
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
      if (mode === "mock") return { attachments: [] as Attachment[], images: [] as LoadedImage[] };
      return await readAttachments(input.service, prepared.assets);
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
      // Notes, not an essay. This stage was spending 30–45k input tokens on
      // prose that the writing stage then compressed away — a deck needs the
      // facts, and the facts are short. Asking for them as a list rather than
      // as exposition is most of the saving.
      const requirements = String((prepared.presentation as { requirements?: string | null }).requirements ?? "").trim().slice(0, 1_200);
      // What the author asked for, and the sources they named, steer the search
      // as well as the writing: a request for "2023-yil statistikasi" is a
      // question for the web, not only for the copywriter.
      const steer = [
        requirements ? `The author's requirements (follow them): ${requirements}` : "",
        prepared.sources.length ? `Sources the author named (use these first): ${prepared.sources.slice(0, 10).join("; ")}` : "",
      ].filter(Boolean).join("\n");
      /**
       * Asked in English, answered in Uzbek.
       *
       * Gemini 3 decides for itself whether to use the search tool, and an
       * Uzbek-language brief with a system role made it search one time in
       * four (measured: ai-diagnose `research_probe`, 2026-10-10). The same
       * request opening with a short English task searched eight times in
       * eight, citing 8–13 pages each — so the task is English and only the
       * notes are Uzbek. The section names stay Uzbek: `sourcesFromNotes`
       * reads MANBALAR.
       */
      const prompt = [
        "Search the web and collect material for an academic presentation on the topic below. Use authoritative pages: official sites, statistics agencies, universities, scientific publications.",
        `Topic: ${prepared.presentation.topic}`,
        steer,
        `Write the answer in ${RESEARCH_IN[deckLanguageOf(prepared.presentation)]} as SHORT lists, with no introduction:`,
        "- FAKTLAR: 8–12 concrete facts, one per line, each followed by its source in brackets.",
        "- RAQAMLAR: 4–8 statistics, each with its year and source.",
        "- DIAGRAMMA UCHUN: at least 3 comparable values with the same unit, year and one source. For shares, say what the total is.",
        "- TA'RIFLAR: 2–4 key definitions, one sentence each.",
        "- MANBALAR: the pages you used.",
        "Do not state anything you could not find a source for. No long paragraphs.",
        context.attachments.length ? "The attached files are part of the material." : "",
      ].filter(Boolean).join("\n");
      try {
        const result = await writer.research({
          prompt,
          attachments: context.attachments,
          maxOutputTokens: 2_500,
        });
        /**
         * Still offered, not imposed: if this answer cites nothing, it is asked
         * once more with the instruction in so many words, and kept only if
         * this time it searched.
         */
        if (result.groundedSearch && result.citations.length === 0) {
          try {
            const again = await writer.research({
              prompt: `You must use Google Search before answering.\n${prompt}`,
              attachments: context.attachments,
              maxOutputTokens: 2_500,
            });
            const usage = {
              input_tokens: (result.usage.input_tokens ?? 0) + (again.usage.input_tokens ?? 0),
              output_tokens: (result.usage.output_tokens ?? 0) + (again.usage.output_tokens ?? 0),
            };
            if (again.citations.length) return { ...again, usage, attempts: result.attempts + again.attempts, failure: null as string | null };
            return { ...result, usage, attempts: result.attempts + again.attempts, failure: null as string | null };
          } catch {
            // The first answer stands; a second try is not worth the deck.
          }
        }
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

    /**
     * Every deck is composed by the Liquid Glass engine, and only by it.
     *
     * The template engine (JSLAYD), the PowerPoint templates and the scene
     * engine that asked a model to place every element of every page are
     * retired. They are not a fallback and no setting reaches them: a deck that
     * quietly came out of a retired engine is exactly what "the old designs must
     * not appear" rules out. The design is invented for this deck below.
     */
    console.log(JSON.stringify({
      event: "design_engine_selected",
      job_id: input.jobId,
      presentation_id: input.presentationId,
      DESIGN_ENGINE: "glass_v1",
      LEGACY_TEMPLATE_USED: false,
    }));

    totalCost += await runGlass({
      input,
      writer,
      mode,
      presentation: prepared.presentation,
      research,
      entered: prepared.sources,
      attachments: context.attachments,
      images: context.images,
      pricing: await providerPricing(input.service),
    });

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

/* ---------------------------------------------- the Liquid Glass engine */

/** Content pages a mock run writes, so the whole path can be exercised without a provider. */
function mockGlassOutline(topic: string, count: number): unknown {
  const kinds = ["statement", "cards", "stats", "process", "bullets", "comparison", "timeline", "quote", "chart"];
  return {
    art: { mode: "dark", hue: 262, mood: "cosmic", typography: "serif", energy: "vivid" },
    shortTitle: topic.slice(0, 40),
    subtitle: "Sinov rejimida yaratilgan taqdimot",
    coverQuery: topic,
    slides: Array.from({ length: count }, (_, index) => ({
      title: `${topic}: ${index + 1}-bo‘lim`,
      kind: kinds[index % kinds.length],
      focus: "Mavzuni mantiqiy rivojlantirish",
      imageQuery: null,
    })),
  };
}

function mockGlassSlide(title: string): unknown {
  return {
    eyebrow: "Sinov",
    title,
    lead: "Bu matn sinov rejimida yozilgan va haqiqiy generatsiyada model tomonidan almashtiriladi.",
    points: [
      { title: "Birinchi fikr", text: "Mavzuning asosiy jihati qisqa va aniq bayon qilinadi." },
      { title: "Ikkinchi fikr", text: "Dalil va misollar bilan qo‘llab-quvvatlanadi." },
      { title: "Uchinchi fikr", text: "Amaliy ahamiyati va xulosasi ko‘rsatiladi." },
    ],
    stats: [{ value: "72%", label: "sinov ko‘rsatkichi" }, { value: "1,4 mln", label: "sinov hajmi" }, { value: "2026", label: "sinov yili" }],
    quote: { text: "Bilim — eng katta boylik.", author: "Xalq maqoli" },
    chart: { labels: ["A", "B", "C"], values: [40, 35, 25], unit: "%", insight: "Sinov diagrammasi." },
    left: { heading: "Birinchi", points: ["Bir", "Ikki", "Uch"] },
    right: { heading: "Ikkinchi", points: ["Bir", "Ikki", "Uch"] },
  };
}

/**
 * A deck, written and composed.
 *
 * Two model calls for the words — the outline, which also carries the art
 * direction, and the copy in parallel batches — then everything else is
 * computed: the design is invented from that direction, the photographs are
 * asked of the image service, and every page is laid out and checked. The
 * stage keys are the ones the phone already draws a progress bar from.
 *
 * Returns the provider cost in dollars.
 */
async function runGlass(params: {
  input: PipelineInput;
  writer: ReturnType<typeof geminiWriter>;
  mode: string;
  presentation: {
    topic: string; style: string; requested_slide_count: number;
    author_name: string | null; teacher_name: string | null; requirements?: string | null;
    design_request?: unknown;
    language?: string | null;
  };
  research: {
    text: string; citations: { title: string; url: string }[];
    usage: { input_tokens?: number; output_tokens?: number }; provider: string; model: string; attempts: number; groundedSearch?: boolean;
  };
  entered: string[];
  attachments: Attachment[];
  /** The author's pictures that were read, each already in the deck's folder. */
  images: LoadedImage[];
  pricing: { for(model: string): { inputPerMillion: number; outputPerMillion: number } };
}): Promise<number> {
  const { input, writer, presentation } = params;
  const mock = params.mode === "mock";
  const calls: Call[] = [];
  const count = Math.max(1, presentation.requested_slide_count - SPECIAL_SLIDES);
  const research = params.research.text.trim();
  const requirements = (presentation.requirements ?? "").trim().slice(0, 2_000);
  const language = deckLanguageOf(presentation);

  const outline = await runStage(input.service, input, "creating_outline", async () => {
    const images = params.images.map(({ key, caption }) => ({ key, caption }));
    if (mock) return placeSourceImages(readOutline(mockGlassOutline(presentation.topic, count), { topic: presentation.topic, count }), images);
    return await writeOutline({ writer, language, topic: presentation.topic, count, research, requirements, attachments: params.attachments, images, calls });
  }, (value) => `${value.slides.length} ta mazmun slaydi rejalashtirildi`);

  const written = await withDeadline(runStage(input.service, input, "writing_content", async () => {
    if (mock) return { slides: outline.slides.map((entry) => readSlide(mockGlassSlide(entry.title), entry)), fallbacks: [] as number[] };
    return await writeSlides({ writer, language, topic: presentation.topic, outline, research, requirements, calls });
  }, (value) => value.fallbacks.length
    ? `${value.slides.length} ta slayd yozildi (${value.fallbacks.length} tasi rejadan tiklandi)`
    : `${value.slides.length} ta slayd matni yozildi`), 150_000, "writing_content");

  const design = await runStage(input.service, input, "visual_identity", async () => {
    const faces = await libraryFaces(input.service);
    const dna = await inventDesign({
      service: input.service, ownerId: input.ownerId, presentationId: input.presentationId,
      // A Russian deck may only be set in faces that draw every Russian letter.
      topic: presentation.topic, art: outline.art, available: facesFor(language, faces.available),
      request: readDesignRequest(presentation.design_request),
    });
    return { dna, face: faces.face };
  }, (value) => `Dizayn yaratildi: ${STYLE_NAMES[value.dna.style]}, ${value.dna.fonts.display.family} + ${value.dna.fonts.body.family}, ${value.dna.direction.mode === "dark" ? "qorong‘i" : "yorug‘"} kompozitsiya`);

  const pictures = await runStage(input.service, input, "finding_assets", async () => {
    const found = mock ? new Map<string, Picture>() : await findPictures({
      service: input.service, ownerId: input.ownerId, presentationId: input.presentationId,
      topic: presentation.topic,
      wanted: pictureWishes(outline, written.slides),
    });
    // The author's own pictures need no search: each is in the deck's folder.
    for (const image of params.images) found.set(image.key, { bucket: image.bucket, path: image.path });
    return found;
  }, (value) => value.size ? `${value.size} ta fotosurat topildi` : "Fotosuratsiz kompozitsiya tanlandi");

  await runStage(input.service, input, "generating_images", async () => pictures.size,
    (value) => value ? `${value} ta rasm shisha ramkalarga joylandi` : "Fon va shisha elementlar generatsiya qilindi");

  const fromNotes = params.entered.length + params.research.citations.length < 3 && !mock
    ? await notesSources(params.research.text)
    : [];
  const cited = mock ? params.research.citations : await resolveCitations(params.research.citations.slice(0, 10));
  const sources = deckSources(params.entered, cited, fromNotes);
  const pages = await runStage(input.service, input, "building_layouts", async () => composeGlassDeck({
    dna: design.dna,
    language,
    face: design.face,
    topic: presentation.topic,
    outline,
    slides: written.slides,
    author: presentation.author_name,
    teacher: presentation.teacher_name,
    sources,
    pictures,
  }), (value) => `${value.length} ta sahifa noldan kompozitsiya qilindi`);

  const rows = glassRows(pages, { ownerId: input.ownerId, presentationId: input.presentationId, newId: () => crypto.randomUUID() });

  await dropUnusedImages(input, params.images, rows.elementRows);

  await runStage(input.service, input, "building_slides", async () => {
    const cleared = await input.service.from("slides").delete().eq("presentation_id", input.presentationId);
    if (cleared.error) throw cleared.error;
    const slides = await input.service.from("slides").insert(rows.slideRows);
    if (slides.error) throw slides.error;
    // In chunks: a thirty-page deck is a few thousand rows, and one insert of
    // all of them is the request most likely to time out.
    for (let start = 0; start < rows.elementRows.length; start += 400) {
      const elements = await input.service.from("slide_elements").insert(rows.elementRows.slice(start, start + 400));
      if (elements.error) throw elements.error;
    }
    if (cited.length && !mock) {
      await input.service.from("presentation_sources").upsert(
        cited.map((citation, position) => ({
          presentation_id: input.presentationId,
          owner_id: input.ownerId,
          label: citation.title.slice(0, 1000),
          url: citation.url,
          position: params.entered.length + position,
          metadata: { discovered_by: "web_search" },
        })),
      );
    }
    return rows;
  }, (value) => `${value.slideRows.length} ta slayd va ${value.elementRows.length} ta tahrirlanadigan element saqlandi`);

  await runStage(input.service, input, "quality_checking", async () => {
    // Every page was checked as it was composed and rebuilt until clean; a
    // fault here would mean the checker and the composer disagree.
    if (rows.faults > 0) console.error(JSON.stringify({ event: "glass_page_faults", job_id: input.jobId, faults: rows.faults }));
    return rows.faults;
  }, (value) => value === 0 ? "Barcha sahifalar tekshirildi: matnlar ustma-ust tushmaydi" : `${value} ta kichik nuqson qayd etildi`);

  // What the words cost, one row per model call, priced by the model that ran it.
  let cost = 0;
  const usageRows = [
    ...(params.research.attempts > 0 ? [{ operation: "topic_research", usage: params.research.usage, provider: params.research.provider, model: params.research.model, attempts: params.research.attempts, metadata: attributionMetadata(params.research as never) }] : []),
    ...calls,
  ].map((call) => {
    const price = usageCost(call.usage, params.pricing.for(call.model));
    cost += price;
    return {
      owner_id: input.ownerId, presentation_id: input.presentationId, job_id: input.jobId,
      provider: call.provider, model: call.model, operation: call.operation,
      input_tokens: call.usage.input_tokens ?? 0, output_tokens: call.usage.output_tokens ?? 0,
      provider_cost_usd: price, request_id: null,
      // The deck's language beside every call, so cost can be read per language.
      metadata: { engine: "glass_v1", attempts: call.attempts, language, ...(call.metadata ?? {}) },
    };
  });
  if (!mock && usageRows.length) {
    const recorded = await input.service.from("ai_usage").insert(usageRows);
    if (recorded.error) console.error("ai usage not recorded", recorded.error.message);
  }

  await runStage(input.service, input, "finalizing", async () => {
    const { data: styleConfig, error: styleError } = await input.service
      .from("style_configs")
      .select("base_credits,credits_per_slide")
      .eq("style", presentation.style as PresentationStyle)
      .single();
    if (styleError) throw styleError;
    // Stock photographs cost us nothing, so they cost the author nothing.
    const actualCredits = Math.ceil(styleConfig.base_credits + presentation.requested_slide_count * Number(styleConfig.credits_per_slide));
    const updated = await input.service.from("presentations").update({
      generated_slide_count: rows.slideRows.length,
      design_engine: "glass_v1",
      design_dna: {
        style: design.dna.style,
        panelLook: design.dna.panelLook,
        direction: design.dna.direction,
        motif: design.dna.motif,
        radius: design.dna.radius,
        colors: design.dna.colors,
        fonts: design.dna.fonts,
        seed: design.dna.seed,
      },
      design_id: null,
      design_version: null,
      generation_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    }).eq("id", input.presentationId);
    if (updated.error) throw updated.error;
    const { error } = await input.service.rpc("settle_generation", {
      p_job_id: input.jobId,
      p_actual_credits: actualCredits,
      p_provider_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    });
    if (error) throw error;
    return actualCredits;
  }, (value) => value > 0 ? `${value} kredit bo‘yicha hisob yakunlandi` : "Tarif hisobidan yakunlandi");

  await input.service.from("generation_steps").update({
    status: "succeeded",
    progress: 100,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    message: "Taqdimot tayyor",
  }).eq("job_id", input.jobId).eq("key", "ready");

  console.log(JSON.stringify({
    event: "glass_deck_finished",
    job_id: input.jobId,
    pages: rows.slideRows.length,
    elements: rows.elementRows.length,
    calls: calls.length,
    fallbacks: written.fallbacks.length,
    pictures: pictures.size,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    motif: design.dna.motif,
    fonts: `${design.dna.fonts.display.family} + ${design.dna.fonts.body.family}`,
  }));
  return cost;
}

/** The language the deck is to be written in; decks from before the choice are Uzbek. */
function deckLanguageOf(presentation: { language?: string | null }): DeckLanguage {
  return isDeckLanguage(presentation.language) ? presentation.language : "uz";
}
