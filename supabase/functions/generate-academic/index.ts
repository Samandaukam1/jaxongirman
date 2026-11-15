/**
 * Writing an academic work, one section at a time.
 *
 * Three actions, and the middle one is the whole design. `plan` researches the
 * topic and lays out the sections; `section` writes exactly one and saves it
 * before answering; `document` renders what has been written.
 *
 * A twenty-page paper produced in one request is a request that fails at page
 * nineteen and leaves nothing. Written a section at a time, a failure costs one
 * section, the work resumes from where it stopped, and — the part the brief
 * asks for — running out of coins pauses the work with everything written so
 * far still in it, rather than refunding somebody for a document they no longer
 * have.
 *
 * Money is handled by the engine that already exists: reserve before the work,
 * settle after it, refund if it fails. Nothing here invents a price.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import {
  PLAN_SCHEMA_NAME, PLAN_SYSTEM, SECTION_SCHEMA_NAME, SECTION_SYSTEM,
  abstractLanguages, documentBlocks, pageOf, planPrompt, planSchema, readLayout, readPlan, readSection, sectionPrompt, sectionSchema,
  sectionWords, skeletonFor, spellUzbek, structureOf, wordCount,
  type Author, type CitationStyle, type DocLanguage, type FigureInput, type Source, type WorkKind,
} from "../_shared/academic.ts";
import { toNewAlphabet } from "../_shared/alphabet.ts";
import { requestContext } from "../_shared/auth.ts";
import { renderTypesetPdf } from "../_shared/blocks-pdf.ts";
import { readSource } from "../_shared/citations.ts";
import { preflight } from "../_shared/cors.ts";
import { buildDocx, type DocxImage } from "../_shared/docx.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

type Body = { workId?: string; action?: "plan" | "section" | "document" | "preview"; format?: "docx" | "pdf" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LANGUAGE_CODES: ReadonlySet<string> = new Set(["uz", "ru", "en", "tr"]);
const languageOf = (work: { language?: string | null }): DocLanguage =>
  (LANGUAGE_CODES.has(String(work.language)) ? work.language : "uz") as DocLanguage;
/** Uzbek is set in the updated alphabet; every other language as written. */
const spellFor = (language: DocLanguage) => (language === "uz" ? spellUzbek : (text: string) => text);
/** The work's sources in one shape, whether the research found them today or an older work stored them. */
const sourcesOf = (work: { sources?: unknown }): Source[] =>
  (Array.isArray(work.sources) ? work.sources : []).map(readSource).filter((source): source is Source => source !== null);

function step(event: string, workId: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, work_id: workId, ...extra }));
}

async function loadWork(service: SupabaseClient, workId: string, ownerId: string) {
  const work = await service
    .from("academic_works").select("*").eq("id", workId).eq("owner_id", ownerId).maybeSingle();
  if (work.error) throw work.error;
  if (!work.data) throw new HttpError(404, "Ish topilmadi.", "not_found");
  return work.data;
}

/**
 * Reserves the coins for one paid step, or says the balance ran out.
 *
 * `jcoin_reserve` is idempotent on its key, so a repeated request costs
 * nothing — which is what makes a section safe to retry.
 */
async function reserve(
  service: SupabaseClient,
  ownerId: string,
  operation: string,
  key: string,
  workId: string,
): Promise<{ ok: boolean; amount: number; reason?: string }> {
  const { data, error } = await service.rpc("jcoin_reserve", {
    p_operation: operation,
    p_idempotency_key: key,
    p_reference_id: workId,
    p_user_id: ownerId,
  });
  if (error) {
    // The engine raises when the balance is short; that is a state, not a fault.
    return { ok: false, amount: 0, reason: error.message };
  }
  const answer = (data ?? {}) as { ok?: boolean; amount?: number };
  return { ok: Boolean(answer.ok), amount: Number(answer.amount ?? 0) };
}

const settle = (service: SupabaseClient, key: string, workId: string) =>
  service.rpc("jcoin_settle", { p_idempotency_key: key, p_reference_id: workId });

const refund = (service: SupabaseClient, key: string, reason: string, workId: string) =>
  service.rpc("jcoin_refund", { p_idempotency_key: key, p_reason: reason, p_reference_id: workId });

/* ------------------------------------------------------------------ plan */

async function plan(service: SupabaseClient, workId: string, ownerId: string) {
  const work = await loadWork(service, workId, ownerId);
  const writer = geminiWriter();
  if (!writer.configured) throw new HttpError(503, "AI xizmati sozlanmagan.", "provider_not_configured");

  const key = `academic:plan:${workId}`;
  const held = await reserve(service, ownerId, "academic_research", key, workId);
  if (!held.ok) {
    await service.from("academic_works").update({
      status: "paused",
      paused_reason: toNewAlphabet("Hisobingizdagi tangalar yetmadi. Tangalar qo‘shib, davom ettiring."),
    }).eq("id", workId);
    throw new HttpError(402, "Tangalar yetarli emas.", "insufficient_credits");
  }

  step("academic_plan_started", workId, { kind: work.kind });
  await service.from("academic_works").update({ status: "planning", paused_reason: null, failure_reason: null }).eq("id", workId);

  try {
    // The skeleton is guessed empirical first only so the planner sees the
    // fuller shape; it decides, and the skeleton is chosen again below.
    const kind = work.kind as WorkKind;
    const language = languageOf(work);
    // An article's structure is the person's choice; an older one without it is decided by the research.
    const chosen = kind === "article" ? structureOf(kind, work.structure, true) : null;
    const skeleton = skeletonFor(kind, chosen, language);
    const prompt = planPrompt({
      kind,
      structure: chosen,
      language,
      topic: work.topic,
      field: work.field,
      requirements: work.requirements,
      skeleton,
    });
    const answer = await writer.structured<unknown>({
      prompt: `${PLAN_SYSTEM}\n\n${prompt}`,
      system: PLAN_SYSTEM,
      schemaName: PLAN_SCHEMA_NAME,
      schema: planSchema(),
      maxOutputTokens: 4_000,
      attempts: 2,
    });

    const draft = readPlan(answer.data, skeleton);
    // An article without a chosen structure takes the one the research supports.
    const structure = kind === "article" && !work.structure ? structureOf(kind, null, draft.empirical) : chosen;
    const settled = structure === chosen ? draft : readPlan(answer.data, skeletonFor(kind, structure, language));
    const spell = spellFor(language);

    const rows = settled.sections.map((section, index) => ({
      work_id: workId,
      owner_id: ownerId,
      position: index,
      key: section.key,
      // Uzbek is shown in the updated alphabet, like everything Uzbek the app writes.
      heading: spell(section.heading),
      brief: section.brief,
      status: "pending",
    }));

    await service.from("academic_sections").delete().eq("work_id", workId);
    const stored = await service.from("academic_sections").insert(rows);
    if (stored.error) throw stored.error;

    const perSection = 25;
    await service.from("academic_works").update({
      status: "writing",
      empirical: settled.empirical,
      structure,
      // The research suggests a UDC code; the author's own, when given, stands.
      udc: String(work.udc ?? "").trim() || settled.udc,
      sources: settled.sources,
      estimated_credits: held.amount + rows.length * perSection,
      spent_credits: held.amount,
    }).eq("id", workId);

    await settle(service, key, workId);
    await service.from("ai_usage").insert({
      owner_id: ownerId,
      provider: "google",
      model: writer.writingModel,
      operation: "research_plan",
      input_tokens: answer.usage.input_tokens ?? 0,
      output_tokens: answer.usage.output_tokens ?? 0,
      request_id: answer.requestId,
      metadata: { work_id: workId, sources: settled.sources.length },
    });

    step("academic_plan_completed", workId, { sections: rows.length, sources: settled.sources.length });
    return { sections: settled.sections, sources: settled.sources, empirical: settled.empirical };
  } catch (failure) {
    await refund(service, key, "academic_plan_failed", workId);
    await service.from("academic_works").update({
      status: "failed",
      failure_reason: toNewAlphabet("Reja tuzilmadi. Qayta urinib ko‘ring."),
    }).eq("id", workId);
    throw failure;
  }
}

/* --------------------------------------------------------------- section */

async function writeSection(service: SupabaseClient, workId: string, ownerId: string) {
  const work = await loadWork(service, workId, ownerId);
  const sections = await service
    .from("academic_sections").select("*").eq("work_id", workId).order("position");
  if (sections.error) throw sections.error;

  const pending = (sections.data ?? []).find((section) => section.status !== "ready");
  if (!pending) {
    await service.from("academic_works").update({ status: "ready", paused_reason: null }).eq("id", workId);
    return { done: true, remaining: 0 };
  }

  const writer = geminiWriter();
  if (!writer.configured) throw new HttpError(503, "AI xizmati sozlanmagan.", "provider_not_configured");

  /**
   * Paid for before it is written, and only once.
   *
   * The key names the section, so retrying one costs nothing and writing the
   * next one is a separate charge. A balance that has run out pauses the work
   * where it stands — every finished section stays.
   */
  const key = `academic:section:${pending.id}`;
  const held = await reserve(service, ownerId, "academic_section", key, workId);
  if (!held.ok) {
    await service.from("academic_works").update({
      status: "paused",
      paused_reason: toNewAlphabet("Hisobingizdagi tangalar tugab qoldi. Tarifingizni yangilang yoki tanga sotib oling — "
        + "yozilgan qismlar saqlab qo‘yildi."),
    }).eq("id", workId);
    throw new HttpError(402, "Tangalar yetarli emas.", "insufficient_credits");
  }

  await service.from("academic_sections").update({ status: "writing" }).eq("id", pending.id);
  step("academic_section_started", workId, { key: pending.key, position: pending.position });

  try {
    const sources = sourcesOf(work);
    const kind = work.kind as WorkKind;
    const language = languageOf(work);
    const structure = structureOf(kind, work.structure, Boolean(work.empirical));
    const earlier = (sections.data ?? [])
      .filter((section) => section.status === "ready" && section.position < pending.position)
      .slice(-3)
      .map((section) => ({
        heading: section.heading as string,
        // A summary rather than the section: the whole document in every
        // request is how a long work costs ten times what it should.
        summary: String(section.body ?? "").replace(/\s+/g, " ").slice(0, 400),
      }));
    const next = (sections.data ?? []).find((section) => section.position === pending.position + 1);

    const prompt = sectionPrompt({
      kind,
      structure,
      language,
      empirical: Boolean(work.empirical),
      topic: work.topic,
      field: work.field,
      key: pending.key as string,
      heading: pending.heading,
      brief: pending.brief,
      earlier,
      next: next ? (next.heading as string) : null,
      sources,
      words: sectionWords(kind, structure, pending.key as string, abstractLanguages(language).length),
    });

    const answer = await writer.structured<unknown>({
      prompt: `${SECTION_SYSTEM}\n\n${prompt}`,
      system: SECTION_SYSTEM,
      schemaName: SECTION_SCHEMA_NAME,
      schema: sectionSchema(),
      // Fifteen hundred Uzbek words, with room to spare.
      maxOutputTokens: 8_000,
      attempts: 2,
    });

    const written = readSection(answer.data, sources.length);
    if (written.body.length < 40) throw new Error("section came back empty");

    // Saved before anything else, which is what makes the work resumable.
    const stored = await service.from("academic_sections").update({
      status: "ready",
      body: spellFor(language)(written.body),
      citations: written.citations,
      words: wordCount(written.body),
    }).eq("id", pending.id);
    if (stored.error) throw stored.error;

    await settle(service, key, workId);
    await service.from("academic_works").update({
      spent_credits: (work.spent_credits ?? 0) + held.amount,
    }).eq("id", workId);

    await service.from("ai_usage").insert({
      owner_id: ownerId,
      provider: "google",
      model: writer.writingModel,
      operation: `${work.kind}_section_write`,
      input_tokens: answer.usage.input_tokens ?? 0,
      output_tokens: answer.usage.output_tokens ?? 0,
      request_id: answer.requestId,
      metadata: { work_id: workId, section: pending.key },
    });

    const remaining = (sections.data ?? []).filter((section) =>
      section.status !== "ready" && section.id !== pending.id).length;
    if (remaining === 0) {
      await service.from("academic_works").update({ status: "ready", paused_reason: null }).eq("id", workId);
    }

    step("academic_section_completed", workId, { key: pending.key, words: wordCount(written.body), remaining });
    return { done: remaining === 0, remaining, heading: pending.heading };
  } catch (failure) {
    await refund(service, key, "academic_section_failed", workId);
    await service.from("academic_sections").update({ status: "failed" }).eq("id", pending.id);
    step("academic_section_failed", workId, {
      key: pending.key,
      detail: String((failure as Error)?.message ?? failure).slice(0, 200),
    });
    throw failure;
  }
}

/* -------------------------------------------------------------- document */

type Figure = { path: string; caption: string; width: number; height: number };

/**
 * Everything the finished paper is made of: its blocks, its pictures and its
 * layout. The authors are the ones the person entered; an older work without
 * any is signed with the profile, as it always was.
 */
async function documentFor(service: SupabaseClient, workId: string, ownerId: string, withPictures: boolean) {
  const work = await loadWork(service, workId, ownerId);
  const sections = await service
    .from("academic_sections").select("key, heading, body, status, figures").eq("work_id", workId).order("position");
  if (sections.error) throw sections.error;
  const written = (sections.data ?? []).filter((section) => section.status === "ready" && section.body);
  if (written.length === 0) throw new HttpError(409, "Hali hech narsa yozilmagan.", "empty");

  let authors: Author[] = (Array.isArray(work.authors) ? work.authors : []).map((entry: Record<string, unknown>) => ({
    name: String(entry?.name ?? ""), affiliation: String(entry?.affiliation ?? ""),
    orcid: String(entry?.orcid ?? ""), email: String(entry?.email ?? ""),
  })).filter((author: Author) => author.name.trim());
  if (authors.length === 0) {
    const profile = await service.from("profiles").select("first_name, last_name, organization").eq("id", ownerId).maybeSingle();
    const account = await service.auth.admin.getUserById(ownerId);
    const name = [profile.data?.last_name, profile.data?.first_name].filter(Boolean).join(" ");
    if (name) authors = [{ name, affiliation: profile.data?.organization ?? "", orcid: "", email: account.data?.user?.email ?? "" }];
  }

  // The person's figures, at most 14 cm wide and 12 cm tall, in proportion.
  const images: DocxImage[] = [];
  const paths: string[] = [];
  const figuresOf = async (list: unknown): Promise<FigureInput[]> => {
    const out: FigureInput[] = [];
    for (const figure of (Array.isArray(list) ? list : []) as Figure[]) {
      if (!figure?.path || !(figure.width > 0) || !(figure.height > 0)) continue;
      const scale = Math.min(14 / figure.width, 12 / figure.height);
      if (withPictures) {
        const file = await service.storage.from("user-uploads").download(figure.path);
        if (file.error || !file.data) continue;
        images.push({ bytes: new Uint8Array(await file.data.arrayBuffer()), extension: figure.path.toLowerCase().endsWith(".png") ? "png" : "jpeg" });
      }
      out.push({ index: paths.length, caption: String(figure.caption ?? ""), widthCm: figure.width * scale, heightCm: figure.height * scale });
      paths.push(figure.path);
    }
    return out;
  };
  const withFigures: { key: string; heading: string; body: string; figures: FigureInput[] }[] = [];
  for (const section of written) {
    withFigures.push({
      key: section.key as string, heading: section.heading as string, body: section.body as string,
      figures: await figuresOf(section.figures),
    });
  }

  const layout = readLayout(work.layout);
  const kind = work.kind as WorkKind;
  const blocks = documentBlocks({
    kind,
    structure: structureOf(kind, work.structure, Boolean(work.empirical)),
    language: languageOf(work),
    title: work.topic,
    field: work.field,
    authors,
    udc: String(work.udc ?? ""),
    acknowledgements: String(work.acknowledgements ?? ""),
    funding: String(work.funding ?? ""),
    sections: withFigures,
    sources: sourcesOf(work),
    style: (work.citation_style ?? "gost") as CitationStyle,
    layout,
  });
  return { blocks, images, paths, layout, sections: written.length };
}

async function render(service: SupabaseClient, workId: string, ownerId: string, format: "docx" | "pdf") {
  const { blocks, images, layout, sections } = await documentFor(service, workId, ownerId, true);
  const page = pageOf(layout);
  const bytes = format === "pdf"
    ? (await renderTypesetPdf({ blocks, images, fontSize: layout.fontSize, page, pageNumbers: layout.pageNumbers })).pdf!
    : await buildDocx({ blocks, images, fontSize: layout.fontSize, page, pageNumbers: layout.pageNumbers });
  const path = `${ownerId}/ilmiy/${workId}.${format}`;
  const upload = await service.storage.from("exports").upload(path, bytes, {
    contentType: format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upload.error) throw upload.error;
  return { storagePath: path, format, sizeBytes: bytes.byteLength, sections };
}

const r1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The A4 preview: the very layout the PDF is drawn from, page by page — each
 * word where the file puts it — compacted for the wire. Pictures come as
 * short-lived links rather than bytes.
 */
async function preview(service: SupabaseClient, workId: string, ownerId: string) {
  const { blocks, paths, layout } = await documentFor(service, workId, ownerId, false);
  const set = (await renderTypesetPdf({
    blocks, fontSize: layout.fontSize, page: pageOf(layout), pageNumbers: layout.pageNumbers, layoutOnly: true,
  })).layout;
  const pictures = await Promise.all(paths.map(async (path) => {
    const signed = await service.storage.from("user-uploads").createSignedUrl(path, 3600);
    return signed.data?.signedUrl ?? null;
  }));
  return {
    width: r1(set.width),
    height: r1(set.height),
    pictures,
    pages: set.pages.map((page) => page.items.map((item) => (item.kind === "text"
      ? [r1(item.x), r1(item.y), r1(item.size), (item.bold ? 1 : 0) + (item.italic ? 2 : 0), item.text]
      : item.kind === "box"
        ? ["b", r1(item.x), r1(item.y), r1(item.width), r1(item.height)]
        : ["i", r1(item.x), r1(item.y), r1(item.width), r1(item.height), item.index]))),
  };
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 8_000);
    const workId = (body.workId ?? "").trim();
    if (!UUID.test(workId)) throw new HttpError(400, "Ish tanlanmadi.", "invalid_work_id");

    const service = context.serviceClient;
    const ownerId = context.user.id;

    if (body.action === "plan") return json({ ok: true, ...await plan(service, workId, ownerId) });
    if (body.action === "preview") return json({ ok: true, ...await preview(service, workId, ownerId) });
    if (body.action === "document") {
      return json({ ok: true, ...await render(service, workId, ownerId, body.format === "pdf" ? "pdf" : "docx") });
    }
    return json({ ok: true, ...await writeSection(service, workId, ownerId) });
  } catch (error) {
    if (error instanceof ProviderUnavailable) {
      return errorResponse(new HttpError(503, "Matn modeli hozir javob bermayapti.", "provider_unavailable"));
    }
    return errorResponse(error);
  }
});
