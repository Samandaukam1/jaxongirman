/**
 * Writing what to say while the deck is on the screen.
 *
 * A slide holds three short lines because that is what a slide is for. The
 * person standing beside it has to talk for about a minute — and the deck does
 * not tell them how, so they read the lines aloud, which is the worst version
 * of a presentation.
 *
 * This is the other document: an opening, a passage per slide, a close. It is
 * emphatically not the slide text again. Where a slide says three words, the
 * passage says the sentence those three words stand for, and then moves to the
 * next slide in a way that sounds like a person rather than a table of
 * contents.
 *
 * Pure — prompt, schema and reader. No provider, no database. What the model is
 * asked and what is accepted back are both testable without either.
 */

export type DefenseSection = {
  slide_number: number;
  slide_title: string;
  speaker_text: string;
  key_point: string;
  transition_to_next: string;
};

export type DefenseScript = {
  introduction: string;
  sections: DefenseSection[];
  conclusion: string;
};

/** One slide, as the writer needs to see it. */
export type DefenseSlide = {
  position: number;
  title: string;
  /** Everything the slide actually shows, joined. May be empty on a cover. */
  text: string;
};

export const DEFENSE_SCHEMA_NAME = "presentation_defense";

export function defenseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      introduction: { type: "string" },
      conclusion: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slide_number: { type: "integer" },
            slide_title: { type: "string" },
            speaker_text: { type: "string" },
            key_point: { type: "string" },
            transition_to_next: { type: "string" },
          },
          required: ["slide_number", "slide_title", "speaker_text", "key_point", "transition_to_next"],
        },
      },
    },
    required: ["introduction", "sections", "conclusion"],
  };
}

/**
 * How long each passage should be, from what the slide holds.
 *
 * A cover needs a greeting and a sentence; a slide of six bullets needs a
 * minute. Asking for "30–60 soniya" everywhere produces the same length
 * everywhere, which is how a script ends up padding a title slide and rushing
 * the one that mattered.
 */
function secondsFor(slide: DefenseSlide): number {
  const words = slide.text.trim() ? slide.text.trim().split(/\s+/).length : 0;
  if (words === 0) return 20;
  return Math.max(25, Math.min(75, 20 + words * 1.6));
}

export function defensePrompt(input: {
  topic: string;
  authorName: string | null;
  teacherName: string | null;
  organization: string | null;
  slides: readonly DefenseSlide[];
}): string {
  const deck = input.slides.map((slide) => ({
    n: slide.position + 1,
    sarlavha: slide.title,
    slaydda: slide.text.replace(/\s+/g, " ").trim().slice(0, 600),
    soniya: Math.round(secondsFor(slide)),
  }));

  return [
    `Mavzu: ${input.topic}`,
    input.authorName ? `Taqdimotchi: ${input.authorName}` : null,
    input.teacherName ? `O‘qituvchi: ${input.teacherName}` : null,
    input.organization ? `O‘quv yurti: ${input.organization}` : null,
    "",
    "Quyidagi taqdimot uchun HIMOYA MATNI yozing — taqdimotchi og‘zaki nima deyishini.",
    "",
    "QOIDALAR:",
    "1. Faqat mukammal o‘zbek lotin tilida. Jonli, og‘zaki nutq — yozma insho emas.",
    "2. Bu slayd matnining takrori EMAS. Slaydda uch so‘z bo‘lsa, nutqda o‘sha uch so‘z nimani anglatishini tushuntiring.",
    "3. Har bir slayd uchun \"soniya\" da ko‘rsatilgan vaqtga yetadigan matn yozing.",
    "4. Kirish qiziqarli boshlansin: savol, kutilmagan kuzatuv, muammo yoki qarama-qarshilik bilan. \"Bugungi kunda...\" va \"Mavzu dolzarbdir\" kabi quruq boshlanishlarni ISHLATMANG.",
    "5. Raqam, sana, foiz yoki tadqiqot natijasini O‘YLAB TOPMANG. Faqat slaydlarda bor ma’lumotga tayaning.",
    "6. \"transition_to_next\" — keyingi slaydga tabiiy o‘tish jumlasi. Oxirgi slaydda yakunlovchi jumla bo‘lsin.",
    "7. \"key_point\" — o‘sha slaydning bitta asosiy fikri, bir jumlada. Bu taqdimotchi uchun eslatma.",
    "8. Xulosa aytilganlarni umumlashtirsin va tinglovchiga murojaat bilan tugasin.",
    "9. Har bir slayd uchun aynan bitta bo‘lim yozing, \"slide_number\" slayd raqamiga to‘g‘ri kelsin.",
    "",
    `SLAYDLAR:\n${JSON.stringify(deck)}`,
  ].filter(Boolean).join("\n");
}

export const DEFENSE_SYSTEM =
  "You are an experienced Uzbek presentation coach writing the spoken script a student will deliver beside their slides. "
  + "Write natural spoken Uzbek Latin — the way a person actually talks in front of a room, not written prose. "
  + "Never invent a statistic, a date, a study or a name: everything you say must be supported by what the slides already contain. "
  + "Never simply read the slide back. Return only the required schema.";

const text = (value: unknown, max: number): string =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The answer, made to match the deck it was written for.
 *
 * A model asked for one section per slide will occasionally return nine for ten
 * slides, or number them from zero, or return them out of order. The screen
 * pairs a section with the slide it belongs to, so a missing one is a slide
 * with nothing to say rather than every later slide showing the wrong passage.
 * Sections are therefore placed by their stated number and gaps are filled,
 * never closed up.
 */
export function readDefense(answer: unknown, slides: readonly DefenseSlide[]): DefenseScript {
  const raw = (answer ?? {}) as Partial<DefenseScript>;
  const given = new Map<number, Partial<DefenseSection>>();
  for (const section of Array.isArray(raw.sections) ? raw.sections : []) {
    const number = Number((section as DefenseSection)?.slide_number);
    if (Number.isInteger(number)) given.set(number, section as DefenseSection);
  }

  const sections = slides.map((slide) => {
    const number = slide.position + 1;
    const section = given.get(number);
    return {
      slide_number: number,
      slide_title: text(section?.slide_title, 200) || slide.title,
      speaker_text: text(section?.speaker_text, 2400),
      key_point: text(section?.key_point, 300),
      transition_to_next: text(section?.transition_to_next, 300),
    };
  });

  return {
    introduction: text(raw.introduction, 2400),
    sections,
    conclusion: text(raw.conclusion, 2400),
  };
}

/** Whether there is enough here to show somebody. */
export function isUsable(script: DefenseScript): boolean {
  if (!script.introduction) return false;
  const written = script.sections.filter((section) => section.speaker_text.length > 20);
  return written.length >= Math.ceil(script.sections.length / 2);
}
