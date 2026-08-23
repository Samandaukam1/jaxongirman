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
  PLAN_SCHEMA_NAME, PLAN_SYSTEM, REFERENCES_HEADING, SECTION_SCHEMA_NAME, SECTION_SYSTEM,
  documentBlocks, planPrompt, planSchema, readPlan, readSection, sectionPrompt, sectionSchema,
  skeletonFor, wordCount, type Source, type WorkKind,
} from "../_shared/academic.ts";
import { requestContext } from "../_shared/auth.ts";
import { renderBlocksPdf } from "../_shared/blocks-pdf.ts";
import { preflight } from "../_shared/cors.ts";
import { buildDocx } from "../_shared/docx.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

type Body = { workId?: string; action?: "plan" | "section" | "document"; format?: "docx" | "pdf" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Roughly how long each kind's sections run. Longer works, longer sections. */
const WORDS: Record<WorkKind, number> = {
  article: 420, independent: 620, referat: 520, coursework: 750,
};

/** Short sections that are lists rather than prose. */
const SHORT = new Set(["keywords", "plan", "abstract"]);

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
      paused_reason: "Hisobingizdagi tangalar yetmadi. Tangalar qo‘shib, davom ettiring.",
    }).eq("id", workId);
    throw new HttpError(402, "Tangalar yetarli emas.", "insufficient_credits");
  }

  step("academic_plan_started", workId, { kind: work.kind });
  await service.from("academic_works").update({ status: "planning", paused_reason: null, failure_reason: null }).eq("id", workId);

  try {
    // The skeleton is guessed empirical first only so the planner sees the
    // fuller shape; it decides, and the skeleton is chosen again below.
    const prompt = planPrompt({
      kind: work.kind as WorkKind,
      topic: work.topic,
      field: work.field,
      requirements: work.requirements,
      skeleton: skeletonFor(work.kind as WorkKind, true),
    });
    const answer = await writer.structured<unknown>({
      prompt: `${PLAN_SYSTEM}\n\n${prompt}`,
      system: PLAN_SYSTEM,
      schemaName: PLAN_SCHEMA_NAME,
      schema: planSchema(),
      maxOutputTokens: 4_000,
      attempts: 2,
    });

    const draft = readPlan(answer.data, skeletonFor(work.kind as WorkKind, true));
    // Now that the planner has answered, the real skeleton is known.
    const settled = readPlan(answer.data, skeletonFor(work.kind as WorkKind, draft.empirical));

    const rows = settled.sections.map((section, index) => ({
      work_id: workId,
      owner_id: ownerId,
      position: index,
      key: section.key,
      heading: section.heading,
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
      failure_reason: "Reja tuzilmadi. Qayta urinib ko‘ring.",
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
      paused_reason: "Hisobingizdagi tangalar tugab qoldi. Tarifingizni yangilang yoki tanga sotib oling — "
        + "yozilgan qismlar saqlab qo‘yildi.",
    }).eq("id", workId);
    throw new HttpError(402, "Tangalar yetarli emas.", "insufficient_credits");
  }

  await service.from("academic_sections").update({ status: "writing" }).eq("id", pending.id);
  step("academic_section_started", workId, { key: pending.key, position: pending.position });

  try {
    const sources = (work.sources ?? []) as Source[];
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
      kind: work.kind as WorkKind,
      topic: work.topic,
      field: work.field,
      heading: pending.heading,
      brief: pending.brief,
      earlier,
      next: next ? (next.heading as string) : null,
      sources,
      words: SHORT.has(pending.key as string) ? 160 : WORDS[work.kind as WorkKind],
    });

    const answer = await writer.structured<unknown>({
      prompt: `${SECTION_SYSTEM}\n\n${prompt}`,
      system: SECTION_SYSTEM,
      schemaName: SECTION_SCHEMA_NAME,
      schema: sectionSchema(),
      maxOutputTokens: 4_000,
      attempts: 2,
    });

    const written = readSection(answer.data, sources.length);
    if (written.body.length < 40) throw new Error("section came back empty");

    // Saved before anything else, which is what makes the work resumable.
    const stored = await service.from("academic_sections").update({
      status: "ready",
      body: written.body,
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

async function render(service: SupabaseClient, workId: string, ownerId: string, format: "docx" | "pdf") {
  const work = await loadWork(service, workId, ownerId);
  const sections = await service
    .from("academic_sections").select("key, heading, body, status").eq("work_id", workId).order("position");
  if (sections.error) throw sections.error;

  const written = (sections.data ?? []).filter((section) => section.status === "ready" && section.body);
  if (written.length === 0) throw new HttpError(409, "Hali hech narsa yozilmagan.", "empty");

  const profile = await service.from("profiles")
    .select("first_name, last_name, organization").eq("id", ownerId).maybeSingle();
  // The address the person signs in with, which is the one an article prints.
  const account = await service.auth.admin.getUserById(ownerId);
  const authorName = [profile.data?.last_name, profile.data?.first_name].filter(Boolean).join(" ") || null;

  const blocks = documentBlocks({
    kind: work.kind as WorkKind,
    topic: work.topic,
    field: work.field,
    authorName,
    organization: profile.data?.organization ?? null,
    email: account.data?.user?.email ?? null,
    sections: written.map((section) => ({
      key: section.key as string,
      heading: section.heading as string,
      body: section.body as string,
    })),
    sources: (work.sources ?? []) as Source[],
  });

  const bytes = format === "pdf"
    ? await renderBlocksPdf({ blocks, fontSize: 14, serif: true })
    : await buildDocx({ blocks, fontSize: 14 });

  const path = `${ownerId}/ilmiy/${workId}.${format}`;
  const upload = await service.storage.from("exports").upload(path, bytes, {
    contentType: format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upload.error) throw upload.error;

  return { storagePath: path, format, sizeBytes: bytes.byteLength, sections: written.length, referencesHeading: REFERENCES_HEADING };
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
