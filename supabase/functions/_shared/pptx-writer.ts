/**
 * Writing into a template's own boxes.
 *
 * A design somebody wrote is a set of fields — a title, a body, some bullets —
 * and the writer is told how much each one holds. A design somebody *imported*
 * is not that. It is a fixed composition of real boxes, built around a
 * photograph, at coordinates that are not negotiable, and the only thing that
 * changes between the template and the finished deck is the words inside them.
 *
 * So the unit here is the box, not the field. Each one is described by what the
 * designer put in it and by how much room it has, and the model is asked for
 * one string per box. §13's rule in one line: the text is fitted to the box,
 * never the box to the text.
 *
 * Three things this file is careful about.
 *
 * **Every box, or the deck does not ship.** A box nobody wrote to keeps the
 * template's own English, and an export carrying somebody else's sample
 * sentence is the failure with no excuse. So a missing answer is filled from
 * what is already known rather than left, and the count of fills is reported.
 *
 * **Spaced-out words are one word.** `C` `A` `M` `P` `U` `S` is six text
 * objects and one word; asked for six independent letters a model returns six
 * unrelated ones. A group is presented once and dealt back across its boxes.
 *
 * **The original text is a measurement, not a source.** It says what length
 * fits and what register the box is in. It is never copied, and the export
 * refuses if it survives.
 *
 * Pure: no Deno, no database, no provider. The caller makes the request.
 */

import { dealAcrossBoxes, type SlotRole } from "./pptx-slots.ts";

/** One box as it is stored — `TextSlotMap`, restated so this file needs nothing. */
export type WritableSlot = {
  shapeId: string;
  role: SlotRole;
  originalText: string;
  paragraphs: number;
  bullets: number;
  characters: number;
  words: number;
  width: number;
  height: number;
  fontSize: number;
  charactersPerLine: number;
  lines: number;
  characterCapacity: number;
  wordCapacity: number;
  letterGroup: number | null;
  binding?: string | null;
};

/**
 * The boxes of a page, if this page was imported by a version that measured them.
 *
 * A design imported before the boxes were measured has rows in the same column
 * holding a different shape — a shape id, a binding and a paragraph count, and
 * nothing about the box. Written against those, the writer would be handed
 * `NaN` for every length and the export would refuse the finished deck for
 * leftover template copy, several minutes and one charge later.
 *
 * So they are checked here and the generator stops at the start with a sentence
 * an admin can act on. Re-importing the template is the fix, and it is two
 * clicks.
 */
export function usableSlots(slots: readonly unknown[]): WritableSlot[] {
  const usable: WritableSlot[] = [];
  for (const entry of slots) {
    const slot = entry as Partial<WritableSlot> | null;
    if (!slot || typeof slot.shapeId !== "string" || !slot.shapeId) continue;
    if (typeof slot.characterCapacity !== "number" || !Number.isFinite(slot.characterCapacity)) continue;
    if (typeof slot.role !== "string") continue;
    usable.push(slot as WritableSlot);
  }
  return usable;
}

/** What the model is asked to fill: a box, or a run of boxes spelling a word. */
type Ask = {
  id: string;
  role: SlotRole;
  shapeIds: string[];
  sample: string;
  aim: number;
  limit: number;
  lines: number;
  paragraphs: number;
  bullets: number;
  words: number;
  fontSize: number;
  box: string;
};

const ROLE_NOTE: Record<SlotRole, string> = {
  display: "sahifaning eng katta so‘zi — qisqa va kuchli",
  title: "sahifa sarlavhasi",
  subtitle: "sarlavhani ochuvchi bitta qator",
  heading: "bo‘lim sarlavhasi",
  body: "izohlovchi matn",
  bullet: "bitta aniq fikr",
  caption: "rasm yoki raqam ostidagi qisqa izoh",
  label: "nom yoki yorliq — bir-ikki so‘z",
  number: "raqam yoki sana",
  letter: "harflab yozilgan bitta so‘z",
};

/**
 * The boxes, grouped and measured, as the model reads them.
 *
 * `aim` is the length the designer used, not the length the box could take.
 * That distinction is the whole of §14: a box built for two words looks wrong
 * with nine in it even though nine fit, and the original is the only reliable
 * statement of what the composition wanted.
 */
export function asksFor(slots: readonly WritableSlot[]): Ask[] {
  const asks: Ask[] = [];
  const groups = new Map<number, WritableSlot[]>();

  for (const slot of slots) {
    if (slot.letterGroup === null) continue;
    const run = groups.get(slot.letterGroup) ?? [];
    run.push(slot);
    groups.set(slot.letterGroup, run);
  }

  const done = new Set<number>();
  for (const slot of slots) {
    if (slot.letterGroup !== null) {
      if (done.has(slot.letterGroup)) continue;
      done.add(slot.letterGroup);
      const run = groups.get(slot.letterGroup)!;
      const word = run.map((entry) => entry.originalText.trim()).join("");
      asks.push({
        id: `w${slot.letterGroup}`,
        role: "letter",
        shapeIds: run.map((entry) => entry.shapeId),
        sample: word,
        // One box may hold more than one letter, so the run is not a hard cap;
        // twice its length still reads as a spaced-out word.
        aim: Math.max(3, word.length),
        limit: Math.max(6, run.length * 2),
        lines: 1, paragraphs: 1, bullets: 0,
        words: 1,
        fontSize: slot.fontSize,
        box: `${slot.width}×${slot.height}`,
      });
      continue;
    }

    asks.push({
      id: slot.shapeId,
      role: slot.role,
      shapeIds: [slot.shapeId],
      sample: slot.originalText.replace(/\s+/g, " ").trim().slice(0, 160),
      aim: Math.max(1, slot.characters),
      limit: Math.max(slot.characters, slot.characterCapacity),
      lines: slot.lines,
      paragraphs: slot.paragraphs,
      bullets: slot.bullets,
      words: Math.max(1, slot.words),
      fontSize: slot.fontSize,
      box: `${slot.width}×${slot.height}`,
    });
  }

  return asks;
}

export const TEMPLATE_SCHEMA_NAME = "template_slide_text";

export function templateSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      boxes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
          },
          required: ["id", "text"],
        },
      },
    },
    required: ["boxes"],
  };
}

export function templatePrompt(input: {
  topic: string;
  index: number;
  title: string;
  purpose: string;
  role?: string;
  roleNote?: string;
  previous: string | null;
  researchBrief: string;
  asks: readonly Ask[];
}): string {
  const table = input.asks.map((ask) => ({
    id: ask.id,
    nima: ROLE_NOTE[ask.role],
    namuna: ask.sample,
    belgi: ask.aim,
    chegara: ask.limit,
    qator: ask.lines,
    abzas: ask.paragraphs,
    ...(ask.bullets > 0 ? { band: ask.bullets } : {}),
    quti: ask.box,
    shrift: ask.fontSize,
  }));

  return [
    `Mavzu: ${input.topic}`,
    `Slayd ${input.index + 1}: ${input.title}`,
    `Maqsad: ${input.purpose}`,
    input.roleNote ? `Bu sahifaning vazifasi: ${input.roleNote}` : null,
    input.previous ? `Oldingi slayd: ${input.previous}` : null,
    "",
    "Bu sahifa tayyor dizayn shablonining sahifasi. Dizayn o‘zgarmaydi — faqat matn almashadi.",
    "Har bir quti uchun bitta matn yozing va uni quti o‘lchamiga moslang.",
    "",
    "QOIDALAR:",
    "1. Faqat mukammal o‘zbek lotin tilida yozing. Inglizcha so‘z qoldirmang.",
    "2. \"namuna\" — shablonning o‘z matni. U faqat uzunlik va ma’no darajasini ko‘rsatadi. Uni tarjima qilmang, ko‘chirmang va takrorlamang.",
    "3. \"belgi\" — mo‘ljallangan belgi soni. Shu atrofda yozing. \"chegara\" dan OSHMANG.",
    "4. \"abzas\" nechta bo‘lsa, shuncha qator yozing — qatorlarni \\n bilan ajrating. Bittadan ortiq abzas so‘ralmagan bo‘lsa, bitta qator yozing.",
    "5. Matn sig‘masa: qisqaroq qayta yozing, ortiqcha so‘zni oling, jumlani soddalashtiring. Qutini kattalashtirish mumkin emas.",
    "6. \"harflab yozilgan bitta so‘z\" uchun faqat BITTA so‘z yozing — u harflarga bo‘lib joylashtiriladi.",
    "7. \"raqam yoki sana\" uchun faqat raqam yoki sana yozing.",
    "8. Har bir id uchun aniq bitta javob bering. Hech bir idni tashlab ketmang.",
    "",
    `QUTILAR:\n${JSON.stringify(table)}`,
    input.researchBrief,
  ].filter(Boolean).join("\n");
}

export type SlotFill = {
  /** What each box will say, by shape id. Covers every slot given. */
  texts: Map<string, string>;
  /** Boxes the model did not answer for and that were filled from elsewhere. */
  filled: string[];
  /** Boxes whose answer was longer than the box and was cut. */
  trimmed: string[];
};

/** Cuts at a word boundary where there is one nearby, so nothing ends mid-word. */
function trimTo(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * The model's answer, turned into one string per box — with every box covered.
 *
 * A slot the model skipped is filled rather than left, because leaving it means
 * shipping the template's own words. Filling is deliberately dull: a heading
 * falls back to the slide's own title and everything else to nothing. An empty
 * box keeps its size, its fill and its place in the composition and simply says
 * nothing, which is a far smaller failure than a box saying "Photojournalist"
 * in the middle of an Uzbek deck.
 */
export function readTemplateAnswer(
  answer: unknown,
  slots: readonly WritableSlot[],
  fallback: { title: string },
): SlotFill {
  const given = new Map<string, string>();
  const boxes = (answer as { boxes?: { id?: unknown; text?: unknown }[] } | null)?.boxes;
  for (const box of Array.isArray(boxes) ? boxes : []) {
    const id = String(box?.id ?? "").trim();
    if (!id) continue;
    given.set(id, String(box?.text ?? "").replace(/\r/g, "").trim());
  }

  const texts = new Map<string, string>();
  const filled: string[] = [];
  const trimmed: string[] = [];

  for (const ask of asksFor(slots)) {
    let written = given.get(ask.id) ?? "";
    /**
     * An answer that repeats the sample is not an answer.
     *
     * The sample is in the prompt because the length a designer chose is the
     * best statement of what fits, and the prompt says not to copy it. A model
     * mostly obeys — and then meets a box saying `www.reallygreatsite.com` and
     * hands it straight back, because there is nothing else a URL could
     * plausibly become. That one box then fails the whole export: leftover
     * template copy is refused, so the deck cannot be downloaded at all.
     *
     * Eight characters is the same threshold the export checks at, so what is
     * caught here is exactly what would be caught there. Below it a repeat is a
     * page number or a year, which is usually the right answer twice.
     */
    if (written && ask.sample.length >= 8 && written.trim().toLowerCase() === ask.sample.trim().toLowerCase()) {
      written = "";
    }
    if (!written) {
      written = ask.role === "display" || ask.role === "title" || ask.role === "heading" || ask.role === "letter"
        ? fallback.title
        : "";
      filled.push(ask.id);
    }
    if (ask.role === "letter") {
      // One word, however many the model sent, dealt across the run.
      const word = written.split(/\s+/).filter(Boolean)[0] ?? "";
      const pieces = dealAcrossBoxes(word.toLocaleUpperCase("uz"), ask.shapeIds.length);
      ask.shapeIds.forEach((shapeId, index) => texts.set(shapeId, pieces[index] ?? ""));
      continue;
    }
    if (written.length > ask.limit) {
      written = trimTo(written, ask.limit);
      trimmed.push(ask.id);
    }
    texts.set(ask.shapeIds[0]!, written);
  }

  return { texts, filled, trimmed };
}

/**
 * Box copy for a slide the server assembled rather than the model wrote.
 *
 * Four slides of every deck are built here from data rather than written: the
 * cover naming the author and their teacher, the agenda, the bibliography and
 * the closing line. They are laid onto template pages like any other slide, so
 * their boxes need copy too — and a box with none is a box that keeps the
 * template's English, which fails the export for the whole deck.
 *
 * Deterministic on purpose. Nothing here is worth a model call: the words
 * already exist and this only has to decide which box each of them goes in.
 * What is left over is emptied, which loses nothing — a template cover has
 * boxes for a strapline and a school name that a generated deck has no answer
 * for, and an empty box keeps its size, its fill and its place.
 */
export function fillFromSlide(
  slots: readonly WritableSlot[],
  slide: { title?: string | null; subtitle?: string | null; body?: string | null; bullets?: readonly string[] },
): Map<string, string> {
  const texts = new Map<string, string>();
  const title = (slide.title ?? "").trim();
  const lines = [
    ...(slide.subtitle ? slide.subtitle.split("\n") : []),
    ...(slide.bullets ?? []),
    ...(slide.body ? [slide.body] : []),
  ].map((line) => line.trim()).filter(Boolean);
  let next = 0;

  for (const ask of asksFor(slots)) {
    if (ask.role === "letter") {
      const word = (title.split(/\s+/)[0] ?? "").toLocaleUpperCase("uz");
      const pieces = dealAcrossBoxes(word, ask.shapeIds.length);
      ask.shapeIds.forEach((shapeId, index) => texts.set(shapeId, pieces[index] ?? ""));
      continue;
    }

    const shapeId = ask.shapeIds[0]!;
    if (ask.role === "display" || ask.role === "title" || ask.role === "heading") {
      texts.set(shapeId, trimTo(title, ask.limit));
      continue;
    }
    if (ask.role === "number") {
      texts.set(shapeId, "");
      continue;
    }
    const line = lines[next];
    if (line === undefined) { texts.set(shapeId, ""); continue; }
    next += 1;
    texts.set(shapeId, trimTo(line, ask.limit));
  }

  return texts;
}

/**
 * The written boxes, read back as the fields the preview draws.
 *
 * The stored slide rows and the phone's editor speak in bindings — title,
 * subtitle, bullets — and a template's boxes were mapped to those at import
 * where a field existed. This turns one into the other so the preview, the PDF
 * and the editor keep working unchanged, while the exported PowerPoint is built
 * from the boxes themselves.
 */
export function bindingsFromSlots(
  slots: readonly WritableSlot[],
  texts: ReadonlyMap<string, string>,
): { title: string | null; subtitle: string | null; body: string | null; bullets: string[] } {
  let title: string | null = null;
  let subtitle: string | null = null;
  let body: string | null = null;
  const bullets: { order: number; text: string }[] = [];

  slots.forEach((slot, order) => {
    const text = texts.get(slot.shapeId)?.trim();
    if (!text) return;
    const binding = slot.binding ?? null;
    if (binding === "title") title ??= text;
    else if (binding === "subtitle") subtitle ??= text;
    else if (binding === "body" || binding === "bullets") body ??= text;
    else if (binding && binding.startsWith("bullet_")) bullets.push({ order, text });
  });

  return {
    title,
    subtitle,
    body,
    bullets: bullets.sort((first, second) => first.order - second.order).map((entry) => entry.text),
  };
}
