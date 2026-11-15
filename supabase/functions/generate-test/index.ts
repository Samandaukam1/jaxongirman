/**
 * A printable test, written by the model from a topic, a text or a deck.
 *
 * The same shape as O‘yingoh's generator: the row is made at once with status
 * `generating`, the questions are written in the background in batches, and
 * the row is flipped to `ready` — or to `failed` with a sentence a person can
 * read. Every question is single-answer multiple choice with exactly the
 * test's number of options, and the right answers are spread over A, B, C…
 * (`questions.ts`).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { toNewAlphabet } from "../_shared/alphabet.ts";
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";
import { mapTestQuestion, spreadAnswers, type RawTestQuestion, type TestQuestionRow } from "../_shared/test-questions.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Body = {
  mode?: "topic" | "text" | "presentation";
  topic?: string;
  text?: string;
  presentationId?: string;
  language?: string;
  difficulty?: string;
  audience?: string;
  questionCount?: number;
  optionCount?: number;
  layout?: "combined" | "separate";
};

const LANGUAGES = ["uz", "en", "ru", "tr"] as const;
type Language = (typeof LANGUAGES)[number];
const isLanguage = (value: unknown): value is Language => typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CYRILLIC = /[Ѐ-ӿ]/;
const DIFFICULTIES = new Set(["oson", "ortacha", "qiyin", "aralash"]);
const AUDIENCES = new Set(["umumiy", "maktab_1_4", "maktab_5_9", "maktab_10_11", "maktab", "universitet", "universitet_bakalavr", "universitet_magistr"]);
const PER_HOUR = 12;
const PER_BATCH = 12;

const WRITE_IN: Record<Language, string> = {
  uz: "- Barcha matn o‘zbek lotin alifbosida (o‘ va g‘ harflari bilan), imloviy xatosiz bo‘lsin.",
  en: "- Write every question, option and explanation in English (these instructions are in Uzbek; the answer is not).",
  ru: "- Все вопросы, варианты и пояснения пишите на русском языке (инструкции на узбекском, ответ — нет).",
  tr: "- Write every question, option and explanation in Turkish with correct Turkish letters (ç ğ ı İ ö ş ü) (these instructions are in Uzbek; the answer is not).",
};
const NEW_TITLE: Record<Language, string> = { uz: "Yangi test", en: "New test", ru: "Новый тест", tr: "Yeni test" };

function difficultyLine(difficulty: string): string {
  switch (difficulty) {
    case "oson": return "Daraja: oson — asosiy faktlar, aniq savollar.";
    case "ortacha": return "Daraja: o‘rtacha — tushunish va bog‘lash talab qilinsin.";
    case "qiyin": return "Daraja: qiyin — tahlil va nozik farqlar.";
    default: return "Daraja: aralash — osondan qiyinga qarab boradigan aralashma.";
  }
}

function audienceLine(audience: string): string {
  switch (audience) {
    case "maktab_1_4": return "Auditoriya: 1–4-sinf o‘quvchilari. Juda sodda til.";
    case "maktab_5_9": return "Auditoriya: 5–9-sinf o‘quvchilari.";
    case "maktab_10_11": return "Auditoriya: 10–11-sinf o‘quvchilari.";
    case "maktab": return "Auditoriya: maktab o‘quvchilari.";
    case "universitet_bakalavr": return "Auditoriya: bakalavriat talabalari.";
    case "universitet_magistr": return "Auditoriya: magistratura talabalari.";
    case "universitet": return "Auditoriya: universitet talabalari.";
    default: return "Auditoriya: keng ommaviy.";
  }
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "questions"],
  properties: {
    title: { type: "string", description: "Test nomi, qisqa va aniq" },
    description: { type: "string", description: "1 gaplik tavsif" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "options", "correct_index", "explanation"],
        properties: {
          prompt: { type: "string", description: "Savol matni" },
          options: { type: "array", items: { type: "string" }, description: "Javob variantlari, aynan so‘ralgan sonda" },
          correct_index: { type: "integer", description: "To‘g‘ri variantning indeksi (0 dan)" },
          explanation: { type: "string", description: "Nega shu javob to‘g‘ri, 1 gap" },
        },
      },
    },
  },
} as const;

type RawTest = { title: string; description: string; questions: RawTestQuestion[] };

function system(language: Language, options: number): string {
  return [
    "Sen o‘qituvchilar uchun chop etiladigan test tuzadigan tajribali metodistsan.",
    "Qoidalar:",
    WRITE_IN[language],
    `- Har bir savol — bitta to‘g‘ri javobli test: aynan ${options} ta variant, ulardan FAQAT bittasi to‘g‘ri.`,
    "- Savollar faktik jihatdan aniq, bir ma’noli va auditoriyaga mos bo‘lsin; savol matnining o‘zi javobni bildirib qo‘ymasin.",
    "- Noto‘g‘ri variantlar ishonarli bo‘lsin: bir xil turdagi, taxminan bir xil uzunlikdagi javoblar.",
    "- «Hammasi to‘g‘ri», «Barcha javoblar», «Hech biri» kabi variantlarni ishlatma.",
    "- Variantlar qisqa bo‘lsin (odatda 1–6 so‘z); savollar takrorlanmasin va mavzuni har tomondan qamrasin.",
  ].join("\n");
}

function prompt(source: string, difficulty: string, audience: string, count: number, onlyFromSource: boolean, language: Language, batch: number): string {
  return [
    source,
    "",
    difficultyLine(difficulty),
    audienceLine(audience),
    `Savollar soni: ${count} ta.`,
    onlyFromSource
      ? "MUHIM: Savollar FAQAT yuqoridagi manba matnidagi ma’lumotlarga asoslansin."
      : "Savollar mavzu bo‘yicha ishonchli, tekshirilgan faktlarga asoslansin.",
    batch > 0 ? `DIQQAT: bu shu testning ${batch + 1}-qismi. Oldingi qismlardagi savollarni takrorlama.` : "",
    WRITE_IN[language].slice(2),
  ].filter(Boolean).join("\n");
}

async function presentationText(service: SupabaseClient, presentationId: string, ownerId: string): Promise<{ text: string; language: string | null }> {
  const { data: deck, error } = await service.from("presentations").select("id, owner_id, title, topic, language").eq("id", presentationId).single();
  if (error || !deck) throw new HttpError(404, "Taqdimot topilmadi.", "presentation_not_found");
  if (deck.owner_id !== ownerId) throw new HttpError(403, "Taqdimot sizga tegishli emas.", "not_owner");
  const { data: elements } = await service
    .from("slide_elements")
    .select("content, type, slide_id, slides!inner(position, presentation_id)")
    .eq("slides.presentation_id", presentationId)
    .eq("type", "text")
    .order("position", { referencedTable: "slides", ascending: true })
    .limit(400);
  const lines: string[] = [`Mavzu: ${deck.title ?? deck.topic ?? ""}`];
  for (const element of elements ?? []) {
    const content = element.content as Record<string, unknown> | null;
    const text = typeof content?.text === "string" ? content.text.trim() : "";
    if (text) lines.push(text);
  }
  const joined = lines.join("\n");
  if (joined.length < 80) throw new HttpError(422, "Taqdimotda test tuzish uchun yetarli matn topilmadi.", "presentation_too_thin");
  return { text: `Manba — taqdimot matni:\n"""\n${joined.slice(0, 12000)}\n"""`, language: deck.language ?? null };
}

async function checkRateLimit(service: SupabaseClient, userId: string): Promise<void> {
  const key = `test-gen:${userId}`;
  const { data } = await service.from("api_rate_limits").select("window_started_at, request_count").eq("key", key).maybeSingle();
  const now = Date.now();
  const fresh = !data || new Date(data.window_started_at).getTime() < now - 3_600_000;
  const count = fresh ? 1 : data.request_count + 1;
  if (count > PER_HOUR) {
    throw new HttpError(429, "Soatiga eng ko‘pi bilan 12 ta test yaratish mumkin. Birozdan so‘ng qayta urinib ko‘ring.", "rate_limited");
  }
  await service.from("api_rate_limits").upsert({
    key,
    window_started_at: fresh ? new Date(now).toISOString() : data!.window_started_at,
    request_count: count,
    updated_at: new Date(now).toISOString(),
  });
}

class Failure extends Error {
  constructor(readonly code: string, readonly detail: string) { super(detail); }
}

function adviceFor(code: string): string {
  switch (code) {
    case "provider_not_configured": return "AI xizmati sozlanmagan. Administratorga xabar bering.";
    case "provider_unavailable": return "AI xizmati hozir javob bermayapti. Bir-ikki daqiqadan so‘ng qayta urinib ko‘ring.";
    case "provider_refused": return "AI so‘rovni bajara olmadi. Savollar sonini kamaytiring yoki mavzuni qisqartiring.";
    case "no_usable_questions": return "AI bu mavzuda test tuza olmadi. Mavzuni aniqroq yozing.";
    case "save_failed": return "Savollar saqlanmadi. Qayta urinib ko‘ring.";
    default: return "Test yaratilmadi. Qayta urinib ko‘ring.";
  }
}

type Task = {
  service: SupabaseClient; ownerId: string; testId: string; source: string; onlyFromSource: boolean;
  difficulty: string; audience: string; count: number; options: number; language: Language;
};

function mockTest(count: number, options: number): RawTest {
  return {
    title: "Sinov testi",
    description: "Mock rejimida yaratilgan test.",
    questions: Array.from({ length: count }, (_, at) => ({
      prompt: `Sinov savoli ${at + 1}: ${at + 2} + ${at + 3} nechaga teng?`,
      options: Array.from({ length: options }, (_, k) => String(2 * at + 5 + k - (at % options))),
      correct_index: at % options,
      explanation: "Qo‘shish.",
    })),
  };
}

async function run(task: Task): Promise<void> {
  const { service } = task;
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ event, test_id: task.testId, user_id: task.ownerId, count: task.count, ...extra }));
  log("test_generation_started");
  try {
    const mode = Deno.env.get("GENERATION_MODE") ?? "real";
    let raw: RawTest;
    let usage = { input_tokens: 0, output_tokens: 0 };
    let model = "mock";
    if (mode === "mock") {
      raw = mockTest(task.count, task.options);
    } else {
      const writer = geminiWriter();
      if (!writer.configured) throw new Failure("provider_not_configured", "GEMINI_API_KEY is not set");
      model = writer.writingModel;
      const sizes: number[] = [];
      for (let left = task.count; left > 0; left -= PER_BATCH) sizes.push(Math.min(PER_BATCH, left));
      const results: (RawTest | null)[] = sizes.map(() => null);
      let first: unknown = null;
      let next = 0;
      const sys = system(task.language, task.options);
      const worker = async () => {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= sizes.length) return;
          try {
            const answer = await writer.structured<RawTest>({
              prompt: `${sys}\n\n${prompt(task.source, task.difficulty, task.audience, sizes[index]!, task.onlyFromSource, task.language, index)}`,
              system: sys,
              schemaName: "printable_test",
              schema: schema as unknown as Record<string, unknown>,
              maxOutputTokens: 6_000,
            });
            results[index] = answer.data;
            usage = {
              input_tokens: usage.input_tokens + (answer.usage.input_tokens ?? 0),
              output_tokens: usage.output_tokens + (answer.usage.output_tokens ?? 0),
            };
          } catch (failure) {
            first = first ?? failure;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const done = results.filter((entry): entry is RawTest => entry !== null);
      if (!done.length) {
        const reason = first instanceof ProviderUnavailable ? first.reason : "unknown";
        const code = reason === "not_configured" ? "provider_not_configured" : /^http_4\d\d$/.test(reason) ? "provider_refused" : "provider_unavailable";
        throw new Failure(code, `${reason}: ${String((first as Error)?.message ?? "").slice(0, 200)}`);
      }
      raw = { title: done[0]!.title, description: done[0]!.description, questions: results.flatMap((entry) => entry?.questions ?? []) };
    }

    const spell = task.language === "uz" ? toNewAlphabet : (text: string) => text;
    const seen = new Set<string>();
    const mapped = raw.questions
      .map((question) => mapTestQuestion(question, task.options, spell))
      .filter((question): question is TestQuestionRow => {
        if (!question || seen.has(question.prompt.toLowerCase())) return false;
        seen.add(question.prompt.toLowerCase());
        return true;
      })
      .slice(0, task.count);
    if (!mapped.length) throw new Failure("no_usable_questions", `model returned ${raw.questions.length}, none usable`);
    const spread = spreadAnswers(mapped, task.testId);

    const { error } = await service.from("test_questions").insert(spread.map((question, position) => ({
      test_id: task.testId, owner_id: task.ownerId, position,
      prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation,
    })));
    if (error) throw new Failure("save_failed", `${error.code ?? ""} ${error.message}`.trim().slice(0, 300));

    const { data: current } = await service.from("tests").select("title, description").eq("id", task.testId).single();
    await service.from("tests").update({
      status: "ready",
      failure_reason: null,
      title: current?.title?.trim() ? current.title : spell(String(raw.title ?? "")).trim().slice(0, 160) || NEW_TITLE[task.language],
      description: current?.description?.trim() ? current.description : spell(String(raw.description ?? "")).trim().slice(0, 2000),
    }).eq("id", task.testId);

    const { data: pricing } = await service.from("app_settings").select("value").eq("key", "ai.provider_pricing").maybeSingle();
    const prices = ((pricing?.value ?? {}) as Record<string, Record<string, number>>)[model] ?? {};
    await service.from("ai_usage").insert({
      owner_id: task.ownerId,
      provider: mode === "mock" ? "mock" : "google",
      model,
      operation: "test_generation",
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      provider_cost_usd: (usage.input_tokens / 1e6) * Number(prices.input_per_million ?? 0) + (usage.output_tokens / 1e6) * Number(prices.output_per_million ?? 0),
      metadata: { test_id: task.testId, count: spread.length, language: task.language },
    });
    log("test_generation_completed", { saved: spread.length });
  } catch (failure) {
    const code = failure instanceof Failure ? failure.code : "unknown";
    const detail = failure instanceof Failure ? failure.detail : String((failure as Error)?.message ?? failure).slice(0, 400);
    log("test_generation_failed", { code, detail });
    await service.from("tests").update({ status: "failed", failure_reason: adviceFor(code), failure_code: code, failure_detail: detail })
      .eq("id", task.testId).eq("status", "generating");
  }
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 64_000);
    const service = context.serviceClient;
    await checkRateLimit(service, context.user.id);

    const mode = body.mode ?? "topic";
    const difficulty = DIFFICULTIES.has(body.difficulty ?? "") ? body.difficulty! : "aralash";
    const audience = AUDIENCES.has(body.audience ?? "") ? body.audience! : "umumiy";
    const count = Number.isInteger(body.questionCount) ? Math.min(Math.max(body.questionCount!, 3), 50) : 20;
    const options = Number.isInteger(body.optionCount) ? Math.min(Math.max(body.optionCount!, 3), 5) : 4;
    let language: Language = isLanguage(body.language) ? body.language : "uz";

    let source: string;
    let onlyFromSource = false;
    let sourceType: "ai" | "text" | "presentation" = "ai";
    let presentationId: string | null = null;
    let title = "";
    if (mode === "presentation") {
      if (!body.presentationId || !UUID.test(body.presentationId)) throw new HttpError(400, "presentationId is required", "invalid_request");
      const deck = await presentationText(service, body.presentationId, context.user.id);
      source = deck.text;
      onlyFromSource = true;
      sourceType = "presentation";
      presentationId = body.presentationId;
      if (!isLanguage(body.language) && isLanguage(deck.language)) language = deck.language;
    } else if (mode === "text") {
      const text = String(body.text ?? "").trim().slice(0, 20_000);
      if (text.length < 80) throw new HttpError(400, "Matn juda qisqa — kamida bir necha jumla kerak.", "text_too_short");
      source = `Manba matn:\n"""\n${text}\n"""`;
      onlyFromSource = true;
      sourceType = "text";
    } else {
      const topic = String(body.topic ?? "").trim().slice(0, 300);
      if (topic.length < 3) throw new HttpError(400, "Mavzuni yozing.", "invalid_topic");
      if (language === "uz" && CYRILLIC.test(topic)) throw new HttpError(400, "Mavzuni lotin yozuvida kiriting.", "cyrillic_topic");
      source = `Mavzu: ${topic}`;
      title = (language === "uz" ? toNewAlphabet(topic) : topic).slice(0, 160);
    }

    const { data: created, error } = await service.from("tests").insert({
      owner_id: context.user.id, title, status: "generating", language, source_type: sourceType,
      source_presentation_id: presentationId, difficulty, audience, option_count: options,
      print_layout: body.layout === "separate" ? "separate" : "combined",
    }).select("id").single();
    if (error || !created) throw error ?? new Error("test row was not created");

    const work = run({ service, ownerId: context.user.id, testId: created.id, source, onlyFromSource, difficulty, audience, count, options, language });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;
    return json({ testId: created.id, status: "generating" }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
