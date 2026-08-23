import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { privacySafeIdentifier, requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/**
 * O‘yingoh question generation.
 *
 * One structured call produces a whole draft quiz; a second mode regenerates a
 * single question without touching its neighbours, so "qayta yaratish" on one
 * card never bills for twenty. Every question lands as an editable draft — the
 * editor owns the final word, never the model.
 *
 * The function never returns AI output to the client directly: it writes
 * `game_questions` rows and flips `games.status` from `generating` to `draft`,
 * which the app observes. Failures flip to `failed` with a reason a person can
 * read. Usage lands in `ai_usage` under `game_generation`, which is where the
 * admin console reads costs from.
 */

type RequestBody = {
  mode?: "topic" | "text" | "presentation" | "regenerate";
  topic?: string;
  text?: string;
  presentationId?: string;
  gameId?: string;
  questionId?: string;
  difficulty?: string;
  audience?: string;
  questionCount?: number;
  types?: string[];
  categoryId?: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The types the model can author with text alone. image_quiz and hotspot need
 * a picture the model does not have; they are added by hand in the editor.
 */
const AI_TYPES = [
  "single_choice", "true_false", "multiple_choice", "ordering", "matching",
  "fill_blank", "word_cloud", "poll", "open_answer",
] as const;
type AiType = typeof AI_TYPES[number];

const DIFFICULTIES = new Set(["oson", "ortacha", "qiyin", "aralash"]);
const AUDIENCES = new Set([
  "maktab_1_4", "maktab_5_9", "maktab_10_11", "universitet_bakalavr",
  "universitet_magistr", "universitet", "maktab", "umumiy",
]);

const GENERATIONS_PER_HOUR = 12;

// ---------------------------------------------------------------- schema --
/**
 * One flat shape for every type, strict-mode friendly: unused fields are null.
 * The mapper below turns each row into the per-type `config` the grader
 * understands, and rejects rows whose fields contradict their type.
 */
const questionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type", "prompt", "explanation", "time_limit_seconds", "base_points",
    "options", "correct_index", "correct_indexes", "correct_boolean",
    "ordered_items", "pairs", "accepted_answers",
  ],
  properties: {
    type: { type: "string", enum: [...AI_TYPES] },
    prompt: { type: "string", description: "Savol matni, o‘zbek lotin alifbosida" },
    explanation: { type: "string", description: "To‘g‘ri javob izohi, 1-2 gap" },
    time_limit_seconds: { type: "integer", enum: [10, 15, 20, 30, 60] },
    base_points: { type: "integer", enum: [0, 500, 1000, 1500, 2000] },
    options: { type: ["array", "null"], items: { type: "string" }, description: "Variantlar (single_choice, multiple_choice, poll)" },
    correct_index: { type: ["integer", "null"], description: "single_choice: to‘g‘ri variant indeksi" },
    correct_indexes: { type: ["array", "null"], items: { type: "integer" }, description: "multiple_choice: to‘g‘ri indekslar" },
    correct_boolean: { type: ["boolean", "null"], description: "true_false: rost bo‘lsa true" },
    ordered_items: { type: ["array", "null"], items: { type: "string" }, description: "ordering: TO‘G‘RI tartibda" },
    pairs: {
      type: ["array", "null"],
      items: {
        type: "object", additionalProperties: false,
        required: ["left", "right"],
        properties: { left: { type: "string" }, right: { type: "string" } },
      },
      description: "matching: juftliklar",
    },
    accepted_answers: { type: ["array", "null"], items: { type: "string" }, description: "fill_blank: qabul qilinadigan yozilishlar" },
  },
} as const;

const gameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "questions"],
  properties: {
    title: { type: "string", description: "O‘yin nomi, qisqa va aniq" },
    description: { type: "string", description: "1-2 gaplik tavsif" },
    questions: { type: "array", items: questionSchema },
  },
} as const;

type RawQuestion = {
  type: AiType;
  prompt: string;
  explanation: string;
  time_limit_seconds: number;
  base_points: number;
  options: string[] | null;
  correct_index: number | null;
  correct_indexes: number[] | null;
  correct_boolean: boolean | null;
  ordered_items: string[] | null;
  pairs: { left: string; right: string }[] | null;
  accepted_answers: string[] | null;
};

type RawGame = { title: string; description: string; questions: RawQuestion[] };

// ---------------------------------------------------------------- mapping --
const optionId = (index: number) => String.fromCharCode(97 + index); // a, b, c …

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

/** Turns one flat AI row into a `game_questions` insert, or explains why not. */
function mapQuestion(raw: RawQuestion): { type: AiType; prompt: string; explanation: string; time: number; points: number; config: Record<string, unknown> } | null {
  const prompt = clean(raw.prompt, 600);
  if (prompt.length < 3) return null;
  const explanation = clean(raw.explanation, 1000);
  const time = [5, 10, 15, 20, 30, 60].includes(raw.time_limit_seconds) ? raw.time_limit_seconds : 20;
  const noScore = raw.type === "word_cloud" || raw.type === "poll";
  const points = noScore ? 0 : ([500, 1000, 1500, 2000].includes(raw.base_points) ? raw.base_points : 1000);

  const options = (raw.options ?? []).map((text) => clean(text, 200)).filter(Boolean).slice(0, 6);

  switch (raw.type) {
    case "single_choice": {
      if (options.length < 2 || raw.correct_index == null || raw.correct_index < 0 || raw.correct_index >= options.length) return null;
      return { type: raw.type, prompt, explanation, time, points, config: {
        options: options.map((text, index) => ({ id: optionId(index), text })),
        correct: optionId(raw.correct_index),
      } };
    }
    case "multiple_choice": {
      const correct = [...new Set(raw.correct_indexes ?? [])].filter((i) => i >= 0 && i < options.length);
      if (options.length < 3 || correct.length < 2) return null;
      return { type: raw.type, prompt, explanation, time, points, config: {
        options: options.map((text, index) => ({ id: optionId(index), text })),
        correct: correct.sort((a, b) => a - b).map(optionId),
      } };
    }
    case "true_false": {
      if (raw.correct_boolean == null) return null;
      return { type: raw.type, prompt, explanation, time, points, config: { correct: raw.correct_boolean } };
    }
    case "ordering": {
      const items = (raw.ordered_items ?? []).map((text) => clean(text, 200)).filter(Boolean).slice(0, 6);
      if (items.length < 3) return null;
      return { type: raw.type, prompt, explanation, time, points, config: {
        items: items.map((text, index) => ({ id: optionId(index), text })),
        order: items.map((_, index) => optionId(index)),
      } };
    }
    case "matching": {
      const pairs = (raw.pairs ?? [])
        .map((pair) => ({ left: clean(pair.left, 120), right: clean(pair.right, 120) }))
        .filter((pair) => pair.left && pair.right)
        .slice(0, 6);
      if (pairs.length < 3) return null;
      return { type: raw.type, prompt, explanation, time, points, config: {
        left: pairs.map((pair, index) => ({ id: `l${optionId(index)}`, text: pair.left })),
        right: pairs.map((pair, index) => ({ id: `r${optionId(index)}`, text: pair.right })),
        pairs: Object.fromEntries(pairs.map((_, index) => [`l${optionId(index)}`, `r${optionId(index)}`])),
      } };
    }
    case "fill_blank": {
      const answers = [...new Set((raw.accepted_answers ?? []).map((text) => clean(text, 120)).filter(Boolean))].slice(0, 10);
      if (answers.length < 1) return null;
      return { type: raw.type, prompt, explanation, time, points, config: { answers } };
    }
    case "poll": {
      if (options.length < 2) return null;
      return { type: raw.type, prompt, explanation, time, points: 0, config: {
        options: options.map((text, index) => ({ id: optionId(index), text })),
      } };
    }
    case "word_cloud":
      return { type: raw.type, prompt, explanation, time, points: 0, config: {} };
    case "open_answer":
      return { type: raw.type, prompt, explanation, time, points, config: {
        reference: explanation, ai_grading: false,
      } };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- prompts --
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

function systemPrompt(): string {
  return [
    "Sen Jaxongirman O‘yingoh uchun bilim o‘yinlari tuzadigan metodistsan.",
    "Qoidalar:",
    "- Barcha matn o‘zbek lotin alifbosida, imloviy xatosiz bo‘lsin. Turkcha yoki ruscha so‘z aralashmasin.",
    "- Har bir savol faktik jihatdan aniq, bir ma’noli va auditoriyaga mos bo‘lsin.",
    "- Noto‘g‘ri variantlar ham mantiqli bo‘lsin — bir qarashda sezilib turmasin.",
    "- Bir xil savolni takrorlama; savollar mavzuni har tomondan qamrasin.",
    "- ordering savolida ordered_items maydonini FAQAT TO‘G‘RI tartibda yoz.",
    "- fill_blank savolida qabul qilinadigan barcha yozilish variantlarini ber (masalan raqam bilan ham, so‘z bilan ham).",
    "- explanation har doim to‘ldirilsin: nima uchun shu javob to‘g‘ri ekani 1-2 gapda.",
  ].join("\n");
}

function userPrompt(source: string, difficulty: string, audience: string, count: number, types: AiType[], onlyFromSource: boolean): string {
  return [
    source,
    "",
    difficultyLine(difficulty),
    audienceLine(audience),
    `Savollar soni: ${count} ta.`,
    `Faqat quyidagi turlardan foydalan: ${types.join(", ")}. Turlarni savollar orasida taqsimla.`,
    onlyFromSource
      ? "MUHIM: Savollar FAQAT yuqoridagi manba matnidagi ma’lumotlarga asoslansin. Manbada yo‘q faktni qo‘shma."
      : "Savollar mavzu bo‘yicha ishonchli, tekshirilgan faktlarga asoslansin.",
  ].join("\n");
}

// ------------------------------------------------------------ source text --
/** Flattens a deck into the text the questions must come from. */
async function presentationText(service: SupabaseClient, presentationId: string, ownerId: string): Promise<string> {
  const { data: presentation, error } = await service
    .from("presentations")
    .select("id, owner_id, title, topic")
    .eq("id", presentationId)
    .single();
  if (error || !presentation) throw new HttpError(404, "Taqdimot topilmadi.", "presentation_not_found");
  if (presentation.owner_id !== ownerId) throw new HttpError(403, "Taqdimot sizga tegishli emas.", "not_owner");

  const { data: elements } = await service
    .from("slide_elements")
    .select("content, type, slide_id, slides!inner(position, presentation_id)")
    .eq("slides.presentation_id", presentationId)
    .eq("type", "text")
    .order("position", { referencedTable: "slides", ascending: true })
    .limit(400);

  const lines: string[] = [`Mavzu: ${presentation.title ?? presentation.topic ?? ""}`];
  for (const element of elements ?? []) {
    const content = element.content as Record<string, unknown> | null;
    const text = typeof content?.text === "string" ? content.text.trim() : "";
    if (text) lines.push(text);
  }
  const joined = lines.join("\n");
  if (joined.length < 80) {
    throw new HttpError(422, "Taqdimotda o‘yin tuzish uchun yetarli matn topilmadi.", "presentation_too_thin");
  }
  return `Manba — taqdimot matni:\n"""\n${joined.slice(0, 12000)}\n"""`;
}

// ------------------------------------------------------------- rate limit --
async function checkRateLimit(service: SupabaseClient, userId: string): Promise<void> {
  const key = `game-gen:${userId}`;
  const { data } = await service.from("api_rate_limits").select("window_started_at, request_count").eq("key", key).maybeSingle();
  const now = Date.now();
  const fresh = !data || new Date(data.window_started_at).getTime() < now - 3_600_000;
  const count = fresh ? 1 : data.request_count + 1;
  if (count > GENERATIONS_PER_HOUR) {
    throw new HttpError(429, "Soatiga eng ko‘pi bilan 12 ta o‘yin yaratish mumkin. Birozdan so‘ng qayta urinib ko‘ring.", "rate_limited");
  }
  await service.from("api_rate_limits").upsert({
    key,
    window_started_at: fresh ? new Date(now).toISOString() : data!.window_started_at,
    request_count: count,
    updated_at: new Date(now).toISOString(),
  });
}

// ------------------------------------------------------------------ mock --
/** GENERATION_MODE=mock: the real flow without a provider, for local smoke. */
function mockGame(source: string, count: number, types: AiType[]): RawGame {
  const questions: RawQuestion[] = [];
  const blank: Omit<RawQuestion, "type"> = {
    prompt: "", explanation: "Sinov izohi.", time_limit_seconds: 20, base_points: 1000,
    options: null, correct_index: null, correct_indexes: null, correct_boolean: null,
    ordered_items: null, pairs: null, accepted_answers: null,
  };
  for (let index = 0; index < count; index += 1) {
    const type = types[index % types.length]!;
    const prompt = `Sinov savoli ${index + 1} (${type})`;
    switch (type) {
      case "single_choice":
        questions.push({ ...blank, type, prompt, options: ["Birinchi", "Ikkinchi", "Uchinchi", "To‘rtinchi"], correct_index: index % 4 });
        break;
      case "multiple_choice":
        questions.push({ ...blank, type, prompt, options: ["Olma", "Anor", "Temir", "Uzum"], correct_indexes: [0, 1, 3] });
        break;
      case "true_false":
        questions.push({ ...blank, type, prompt, correct_boolean: index % 2 === 0 });
        break;
      case "ordering":
        questions.push({ ...blank, type, prompt, ordered_items: ["Birinchi bosqich", "Ikkinchi bosqich", "Uchinchi bosqich", "To‘rtinchi bosqich"] });
        break;
      case "matching":
        questions.push({ ...blank, type, prompt, pairs: [
          { left: "Al-Xorazmiy", right: "Algebra" },
          { left: "Amir Temur", right: "1336" },
          { left: "Toshkent", right: "O‘zbekiston" },
        ] });
        break;
      case "fill_blank":
        questions.push({ ...blank, type, prompt: `${prompt}: O‘zbekiston poytaxti — ...`, accepted_answers: ["Toshkent", "toshkent shahri"] });
        break;
      case "poll":
        questions.push({ ...blank, type, prompt, base_points: 0, options: ["Ha", "Yo‘q", "Bilmayman"] });
        break;
      case "word_cloud":
        questions.push({ ...blank, type, prompt, base_points: 0 });
        break;
      case "open_answer":
        questions.push({ ...blank, type, prompt });
        break;
    }
  }
  return { title: `Sinov o‘yini — ${source.slice(0, 40)}`, description: "Mock rejimida yaratilgan sinov o‘yini.", questions };
}

/**
 * How many questions to ask for at a time.
 *
 * The whole quiz used to be one request: up to thirty questions, a twelve-field
 * schema with a union in every second property, and a sixteen-thousand-token
 * ceiling. Gemini answers a request that size with "Request contains an invalid
 * argument", which names nothing — and the refusal follows the count rather
 * than any word in the prompt. The presentation pipeline met exactly this and
 * the fix there was to write one slide per request; every game since the
 * sixteenth of August has failed for what is almost certainly the same reason.
 *
 * Four keeps a batch well under any of the limits and still costs three
 * requests for the default ten. A batch that fails no longer takes the others
 * with it: nine good questions are a game, and an error message is not.
 */
const QUESTIONS_PER_BATCH = 4;

export function batchSizes(count: number): number[] {
  const sizes: number[] = [];
  for (let left = Math.max(1, count); left > 0; left -= QUESTIONS_PER_BATCH) {
    sizes.push(Math.min(QUESTIONS_PER_BATCH, left));
  }
  return sizes;
}

/**
 * The quiz, asked for a few questions at a time.
 *
 * Batches run three at a time, which is what the deck writer settled on for the
 * same provider. Order is preserved regardless of which finished first, because
 * a quiz whose questions arrive shuffled by network timing is a different quiz
 * every time it is generated.
 *
 * A batch that fails is recorded and skipped. Every batch failing is the only
 * failure, and it carries the first reason rather than the last, because the
 * first is the one that was not caused by whatever the first one did.
 */
async function writeInBatches(
  task: GenerationTask,
  writer: ReturnType<typeof geminiWriter>,
  system: string,
  promptFor: (batch: number, index: number) => string,
  onUsage: (answer: { usage: { input_tokens?: number; output_tokens?: number }; requestId: string | null }) => void,
): Promise<RawGame> {
  const sizes = batchSizes(task.count);
  const results: (RawGame | null)[] = new Array(sizes.length).fill(null);
  let firstFailure: unknown = null;
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= sizes.length) return;
      try {
        const answer = await writer.structured<RawGame>({
          prompt: `${system}\n\n${promptFor(sizes[index]!, index)}`,
          system,
          schemaName: "oyingoh_game",
          schema: gameSchema as unknown as Record<string, unknown>,
          // Four questions with options and explanations, with room to spare.
          maxOutputTokens: 6_000,
        });
        results[index] = answer.data;
        onUsage(answer);
      } catch (failure) {
        firstFailure = firstFailure ?? failure;
        stage("game_generation_batch_failed", task, { batch: index, size: sizes[index] });
      }
    }
  };

  await Promise.all([worker(), worker(), worker()]);

  const done = results.filter((entry): entry is RawGame => entry !== null);
  if (done.length === 0) throw firstFailure ?? new Error("no batch returned");
  if (done.length < sizes.length) {
    stage("game_generation_batches_partial", task, { asked: sizes.length, got: done.length });
  }

  return {
    title: done[0]!.title,
    description: done[0]!.description,
    questions: results.flatMap((entry) => entry?.questions ?? []).slice(0, task.count),
  };
}

// ------------------------------------------------------------- generation --
type GenerationTask = {
  service: SupabaseClient;
  ownerId: string;
  gameId: string;
  source: string;
  onlyFromSource: boolean;
  difficulty: string;
  audience: string;
  count: number;
  types: AiType[];
  safetyIdentifier: string;
  /** When set, replace exactly this question instead of filling the game. */
  replaceQuestionId?: string;
  replacePosition?: number;
};

async function providerPricing(service: SupabaseClient, model: string) {
  const { data } = await service.from("app_settings").select("value").eq("key", "ai.provider_pricing").maybeSingle();
  const value = data?.value && typeof data.value === "object" && !Array.isArray(data.value) ? data.value as Record<string, unknown> : {};
  const text = value[model] as Record<string, number> | undefined;
  return { inputPerMillion: Number(text?.input_per_million ?? 0), outputPerMillion: Number(text?.output_per_million ?? 0) };
}

/**
 * One line per stage, so a failure can be found without the edge log.
 *
 * The log is where the cause went and the log is not reachable from a laptop.
 * These lines are still logs — but they name the stage, so the moment one
 * question of a batch is the problem, or the provider is, the row and the line
 * agree about which.
 */
function stage(event: string, task: GenerationTask, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    event,
    game_id: task.gameId,
    user_id: task.ownerId,
    count: task.count,
    ...extra,
  }));
}

/** What went wrong, in a shape the row can hold and a person cannot be shown. */
class GenerationFailure extends Error {
  constructor(readonly code: string, readonly detail: string, readonly advice?: string) {
    super(detail);
  }
}

/**
 * The sentence the person who pressed the button reads.
 *
 * Specific wherever the cause is known, because "qayta urinib ko‘ring" is not
 * advice when retrying is exactly what will not help.
 */
function adviceFor(code: string): string {
  switch (code) {
    case "provider_not_configured":
      return "AI xizmati sozlanmagan. Administratorga xabar bering.";
    case "provider_unavailable":
      return "AI xizmati hozir javob bermayapti. Bir-ikki daqiqadan so‘ng qayta urinib ko‘ring.";
    case "provider_refused":
      return "AI so‘rovni bajara olmadi. Savollar sonini kamaytiring yoki mavzuni qisqartiring.";
    case "no_usable_questions":
      return "AI bu mavzuda savol tuza olmadi. Mavzuni aniqroq yozing yoki boshqa savol turlarini tanlang.";
    case "save_failed":
      return "Savollar saqlanmadi. Qayta urinib ko‘ring.";
    default:
      return "O‘yin yaratilmadi. Qayta urinib ko‘ring — muammo takrorlansa mavzuni qisqartiring.";
  }
}

async function runGeneration(task: GenerationTask): Promise<void> {
  const { service } = task;
  stage("game_generation_started", task, { mode: task.replaceQuestionId ? "regenerate" : "fill" });
  try {
    const mode = Deno.env.get("GENERATION_MODE") ?? "real";
    let game: RawGame;
    let usage: { input_tokens?: number; output_tokens?: number } = {};
    let requestId: string | null = null;
    let model = "mock";

    if (mode === "mock") {
      game = mockGame(task.source, task.count, task.types);
    } else {
      /**
       * The last thing on OpenAI, moved for the reason everything else was.
       *
       * Games were left alone when the presentation pipeline changed vendors,
       * on the grounds that they are a different product and the brief said not
       * to disturb them. That reasoning ignored the only thing that mattered:
       * a zero balance is not a property of a pipeline, it is a property of the
       * account — so "O'yin yaratilmadi" was the same outage wearing a
       * different message, and it arrived exactly as predicted.
       */
      const writer = geminiWriter();
      if (!writer.configured) {
        throw new GenerationFailure("provider_not_configured", "GEMINI_API_KEY is not set");
      }
      model = writer.writingModel;

      const system = systemPrompt();
      stage("game_generation_ai_started", task, { model, batches: batchSizes(task.count).length });
      try {
        game = await writeInBatches(task, writer, system, (batch, index) =>
          userPrompt(task.source, task.difficulty, task.audience, batch, task.types, task.onlyFromSource)
          + (index === 0 ? "" : `\n\nDIQQAT: bu shu o‘yinning ${index + 1}-to‘plami. Oldingi to‘plamlardagi savollarni takrorlama.`),
          (batchUsage) => {
            usage = {
              input_tokens: (usage.input_tokens ?? 0) + (batchUsage.usage.input_tokens ?? 0),
              output_tokens: (usage.output_tokens ?? 0) + (batchUsage.usage.output_tokens ?? 0),
            };
            requestId = requestId ?? batchUsage.requestId;
          });
      } catch (refusal) {
        /**
         * Which half of "the model did not answer" this was.
         *
         * A provider that is down and a provider that read the request and
         * would not do it need different sentences: one is worth waiting out,
         * the other is worth asking for less. Told apart by the writer's own
         * reason rather than by matching on message text.
         */
        const reason = refusal instanceof ProviderUnavailable ? refusal.reason : "unknown";
        /**
         * A 4xx is the model reading the request and declining it — the schema,
         * the size, the count. Asking again changes nothing, so the person is
         * told to ask for less rather than to wait. Everything else is weather.
         */
        const declined = /^http_4\d\d$/.test(reason);
        const code = reason === "not_configured"
          ? "provider_not_configured"
          : declined ? "provider_refused" : "provider_unavailable";
        throw new GenerationFailure(code, `${reason}: ${String((refusal as Error)?.message ?? "").slice(0, 200)}`);
      }
      stage("game_generation_ai_completed", task, {
        model,
        returned: game.questions?.length ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      });
    }

    const returned = game.questions?.length ?? 0;
    const mapped = game.questions.map(mapQuestion).filter((question) => question !== null);
    /**
     * One malformed question used to lose the whole game.
     *
     * `mapQuestion` rejects a row whose fields contradict its type — a
     * `single_choice` with no options, a `matching` with no pairs — which is
     * right, because such a row cannot be graded. What was wrong was throwing
     * away the other eleven with it. A game of nine good questions is a game;
     * an error message is not.
     */
    if (mapped.length < 1) {
      throw new GenerationFailure(
        "no_usable_questions",
        `model returned ${returned} question(s), none usable`,
      );
    }
    if (mapped.length < returned) {
      stage("game_generation_partial", task, { returned, usable: mapped.length });
    }

    if (task.replaceQuestionId) {
      const question = mapped[0]!;
      const { error } = await service.from("game_questions").update({
        type: question.type,
        prompt: question.prompt,
        explanation: question.explanation,
        time_limit_seconds: question.time,
        base_points: question.points,
        config: question.config,
      }).eq("id", task.replaceQuestionId).eq("game_id", task.gameId);
      if (error) throw error;
      await service.from("games").update({ status: "draft", failure_reason: null }).eq("id", task.gameId);
    } else {
      const rows = mapped.map((question, index) => ({
        game_id: task.gameId,
        owner_id: task.ownerId,
        position: index,
        type: question.type,
        prompt: question.prompt,
        explanation: question.explanation,
        time_limit_seconds: question.time,
        base_points: question.points,
        config: question.config,
      }));
      const { error } = await service.from("game_questions").insert(rows);
      if (error) throw new GenerationFailure("save_failed", `${error.code ?? ""} ${error.message}`.trim().slice(0, 300));
      stage("game_generation_saved", task, { saved: rows.length });

      const { data: current } = await service.from("games").select("title, description").eq("id", task.gameId).single();
      await service.from("games").update({
        status: "draft",
        failure_reason: null,
        title: current?.title?.trim() ? current.title : clean(game.title, 160) || "Yangi o‘yin",
        description: current?.description?.trim() ? current.description : clean(game.description, 2000),
      }).eq("id", task.gameId);
    }

    const pricing = await providerPricing(service, model);
    await service.from("ai_usage").insert({
      owner_id: task.ownerId,
      provider: mode === "mock" ? "mock" : "google",
      model,
      operation: task.replaceQuestionId ? "game_question_regeneration" : "game_generation",
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      provider_cost_usd: ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion
        + ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion,
      request_id: requestId,
      metadata: { game_id: task.gameId, count: mapped.length },
    });
    stage("game_generation_completed", task, { saved: mapped.length });
  } catch (failure) {
    const code = failure instanceof GenerationFailure ? failure.code : "unknown";
    const detail = failure instanceof GenerationFailure
      ? failure.detail
      : String((failure as Error)?.message ?? failure).slice(0, 400);

    stage("game_generation_failed", task, { code, detail });

    /**
     * The cause is written to the row, not only to the log.
     *
     * Every failure since the sixteenth carried one generic sentence, so five
     * of them were indistinguishable — and the real reason went to a log this
     * machine cannot read. Now the row itself says which stage and why, while
     * the person still reads one sentence in their own language.
     */
    await service.from("games").update({
      status: "failed",
      failure_reason: adviceFor(code),
      failure_code: code,
      failure_detail: detail,
    }).eq("id", task.gameId).eq("status", "generating");
  }
}

// ---------------------------------------------------------------- handler --
Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<RequestBody>(request, 64_000);
    const mode = body.mode ?? "topic";
    const service = context.serviceClient;

    await checkRateLimit(service, context.user.id);

    const difficulty = DIFFICULTIES.has(body.difficulty ?? "") ? body.difficulty! : "aralash";
    const audience = AUDIENCES.has(body.audience ?? "") ? body.audience! : "umumiy";
    const requestedTypes = (body.types ?? []).filter((type): type is AiType => (AI_TYPES as readonly string[]).includes(type));
    const types: AiType[] = requestedTypes.length ? requestedTypes : ["single_choice", "true_false", "multiple_choice", "fill_blank"];
    const count = Number.isInteger(body.questionCount) ? Math.min(Math.max(body.questionCount!, 1), 30) : 10;
    const safetyIdentifier = await privacySafeIdentifier(context.user.id);

    if (mode === "regenerate") {
      if (!body.gameId || !uuidPattern.test(body.gameId) || !body.questionId || !uuidPattern.test(body.questionId)) {
        throw new HttpError(400, "gameId and questionId are required", "invalid_request");
      }
      const { data: question, error } = await service
        .from("game_questions")
        .select("id, game_id, owner_id, position, type, prompt, games!game_questions_game_owner_fkey(title, source_presentation_id)")
        .eq("id", body.questionId)
        .eq("game_id", body.gameId)
        .single();
      if (error || !question) throw new HttpError(404, "Savol topilmadi.", "question_not_found");
      if (question.owner_id !== context.user.id) throw new HttpError(403, "Bu o‘yin sizga tegishli emas.", "not_owner");
      const gameRow = question.games as unknown as { title: string; source_presentation_id: string | null };

      let source = `Mavzu: ${gameRow.title}`;
      if (gameRow.source_presentation_id) {
        source = await presentationText(service, gameRow.source_presentation_id, context.user.id);
      }
      source += `\n\nHozirgi savol (yangisi bilan almashtiriladi, takrorlama): "${question.prompt}"`;

      const task: GenerationTask = {
        service, ownerId: context.user.id, gameId: body.gameId, source,
        onlyFromSource: Boolean(gameRow.source_presentation_id),
        difficulty, audience, count: 1,
        types: [(question.type as AiType) ?? "single_choice"],
        safetyIdentifier,
        replaceQuestionId: body.questionId,
        replacePosition: question.position,
      };
      const work = runGeneration(task);
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
      return json({ gameId: body.gameId, questionId: body.questionId, status: "generating" }, 202);
    }

    // Fresh game. Build the source first so a thin presentation fails before a
    // row is created.
    let source: string;
    let onlyFromSource = false;
    let sourceType: "ai" | "text" | "presentation" = "ai";
    let presentationId: string | null = null;
    let title = "";

    if (mode === "presentation") {
      if (!body.presentationId || !uuidPattern.test(body.presentationId)) {
        throw new HttpError(400, "presentationId is required", "invalid_request");
      }
      source = await presentationText(service, body.presentationId, context.user.id);
      onlyFromSource = true;
      sourceType = "presentation";
      presentationId = body.presentationId;
    } else if (mode === "text") {
      const text = clean(body.text, 20_000);
      if (text.length < 80) throw new HttpError(400, "Matn juda qisqa — kamida bir necha jumla kerak.", "text_too_short");
      source = `Manba matn:\n"""\n${text}\n"""`;
      onlyFromSource = true;
      sourceType = "text";
    } else {
      const topic = clean(body.topic, 300);
      if (topic.length < 3) throw new HttpError(400, "Mavzuni yozing.", "invalid_topic");
      source = `Mavzu: ${topic}`;
      title = topic.slice(0, 160);
    }

    const { data: created, error: createError } = await service
      .from("games")
      .insert({
        owner_id: context.user.id,
        title,
        status: "generating",
        source_type: sourceType,
        source_presentation_id: presentationId,
        difficulty,
        audience,
        category_id: body.categoryId && uuidPattern.test(body.categoryId) ? body.categoryId : null,
      })
      .select("id")
      .single();
    if (createError || !created) throw createError ?? new Error("game row was not created");

    const task: GenerationTask = {
      service, ownerId: context.user.id, gameId: created.id, source, onlyFromSource,
      difficulty, audience, count, types, safetyIdentifier,
    };
    const work = runGeneration(task);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;

    return json({ gameId: created.id, status: "generating" }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
