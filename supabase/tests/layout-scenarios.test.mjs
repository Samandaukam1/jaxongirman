import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEdgeModules } from "../scripts/build-edge.mjs";
import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const edge = buildEdgeModules();
const pkg = buildJslayd();

const { buildJslaydSlides, readDesign } = await import(`${edge}/jslayd-layout.js`);
const { buildWritingBrief, checkFit, planArchetypes, purposeForLayout } = await import(`${pkg}/index.js`);

/**
 * The ten shapes a deck actually comes in, run through the real renderer.
 *
 * Against the fifteen real designs rather than one sample: geometry that holds
 * on a spacious editorial layout can fail on a dense dashboard, and the failure
 * this whole change exists to stop — copy written first, squeezed in
 * afterwards — only shows up on the tight ones.
 *
 * Every scenario asserts the same four things, which is the brief's own list:
 * nothing overflows its box, nothing is clipped, no text collides with another
 * text, and no font is dragged below what a person can read.
 */

const CORPUS = JSON.parse(
  readFileSync(path.join(here, "..", "..", "packages", "jslayd", "tests", "fixtures", "design-corpus.json"), "utf8"),
);

/**
 * The renderer works in model units, not canvas units.
 *
 * A design is authored on 1920×1080 and projected onto the 1000-wide model the
 * apps and the exporters draw, so a 23px label arrives as 12. Comparing a
 * rendered size against a canvas-space threshold reads every design as broken —
 * which is what the first version of this test did before the arithmetic was
 * checked. `MIN_RENDER_FONT_SIZE` is the floor in the space these numbers are
 * actually in.
 */
const CANVAS = { width: 1000, height: 562.5 };
const MIN_READABLE = 12;
const OWNER = "33330000-0000-4000-8000-000000000003";
const PRESENTATION = "22220000-0000-4000-8000-000000000002";

function slide(title, layout, extra = {}) {
  return {
    title, subtitle: null, purpose: "Namuna", layout,
    bullets: [], body: null, quote: null, statistic: null, chart: null, table: null,
    visualPrompt: null, ...extra,
  };
}

/**
 * Stands in for the model's rewrite.
 *
 * The pipeline asks Gemini to shorten copy that misses its budget; a test
 * cannot call a model, so this cuts at a word boundary instead. It is a worse
 * writer and that is fine — what is under test is whether the loop produces
 * something that renders cleanly, not whether the prose is good.
 */
function compressToBudget(text, slot) {
  let candidate = text.trim();
  while (candidate.length > 0 && !checkFit(slot, candidate).fits) {
    const cut = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.85)));
    const boundary = cut.lastIndexOf(" ");
    candidate = (boundary > 8 ? cut.slice(0, boundary) : cut).trim();
  }
  return candidate;
}

const FIELD_OF = {
  title: "title", subtitle: "subtitle", body: "body", bullets: "bullets",
  quote_text: "quote", stat_value: "statistic", stat_label: "statistic",
};

/** Runs the copy through the budget the way the pipeline does, before rendering. */
function fitToArchetype(document, archetype, written) {
  const brief = buildWritingBrief(document, archetype, { language: "uz" });
  let slide = { ...written };

  for (const slot of brief.slots) {
    const field = FIELD_OF[slot.binding];
    if (!field) continue;

    if (slot.binding === "title" && slide.title) slide.title = compressToBudget(slide.title, slot);
    if (slot.binding === "subtitle" && slide.subtitle) slide.subtitle = compressToBudget(slide.subtitle, slot);
    if (slot.binding === "body" && slide.body) slide.body = compressToBudget(slide.body, slot);
    if (slot.binding === "quote_text" && slide.quote) {
      slide.quote = { ...slide.quote, text: compressToBudget(slide.quote.text, slot) };
    }
    if (slot.binding === "stat_label" && slide.statistic) {
      slide.statistic = { ...slide.statistic, label: compressToBudget(slide.statistic.label, slot) };
    }
    if (slot.binding === "bullets" && slide.bullets.length > 0) {
      const perItem = Math.max(8, Math.floor(slot.budget.preferredCharacters / Math.max(1, slide.bullets.length)));
      slide.bullets = slide.bullets
        .slice(0, slot.budget.maximumItems ?? slide.bullets.length)
        .map((item) => (item.length <= perItem ? item : item.slice(0, perItem).replace(/\s+\S*$/, "")));
    }
  }

  return slide;
}

/**
 * Plans a deck the way the pipeline does, fits the copy to the chosen
 * compositions, and renders it — so what is asserted is what a user receives.
 */
function render(document, slides, { paletteCode = null, images = [] } = {}) {
  const chosen = planArchetypes(document, slides.map((entry) => {
    const purpose = purposeForLayout(entry.layout);
    return {
      purpose,
      needsChart: purpose === "chart",
      needsTable: purpose === "table",
      needsStats: purpose === "statistics",
      needsQuote: purpose === "quote",
    };
  }));

  const fitted = slides.map((entry, index) => fitToArchetype(document, chosen[index].archetype, entry));

  const built = buildJslaydSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    design: readDesign({ id: "11110000-0000-4000-8000-000000000001", slug: document.design.slug, version: 1, compiled_config: document }).design,
    slides: fitted,
    sources: ["Manba bir", "Manba ikki"],
    generatedImages: images,
    uploadedImages: [],
    authorName: "Jahongir",
    teacherName: "O'qituvchi",
    paletteCode,
    archetypeIds: chosen.map((selection) => selection.archetype.id),
  });

  return { built, chosen };
}

/** The four checks, applied to every rendered slide. */
function assertClean(built, label) {
  for (const element of built.elements) {
    assert.ok(
      element.x >= -1 && element.y >= -1
        && element.x + element.width <= CANVAS.width + 1
        && element.y + element.height <= CANVAS.height + 1
        || element.type !== "text",
      `${label}: text ${element.id} left the canvas (${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.width)}×${Math.round(element.height)})`,
    );

    if (element.type === "text") {
      const size = Number(element.style?.fontSize ?? 0);
      assert.ok(size >= MIN_READABLE, `${label}: ${element.id} was shrunk to ${size}, below what anybody can read`);
    }
  }

  // Two blocks of copy on top of each other is the collision that matters; a
  // caption over a photograph is a composition.
  const texts = built.elements.filter((element) => element.type === "text");
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const first = texts[a];
      const second = texts[b];
      if (first.slide_id !== second.slide_id) continue;
      const overlapX = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
      const overlapY = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
      const smaller = Math.min(first.width * first.height, second.width * second.height);
      assert.ok(
        overlapX * overlapY <= smaller * 0.25,
        `${label}: ${first.id} and ${second.id} sit on top of each other`,
      );
    }
  }

  for (const row of built.slides) {
    assert.ok(row.quality_score >= 70, `${label}: slide scored ${row.quality_score}`);
  }
}

/** Runs one scenario against every design in the corpus. */
function everywhere(label, slides, options) {
  for (const document of CORPUS) {
    const { built } = render(document, slides, options);
    assert.equal(built.slides.length, slides.length, `${document.design.slug}: one row per slide`);
    assertClean(built, `${label} / ${document.design.slug}`);
  }
}

/* ------------------------------------------------------------ the ten */

test("1. a long Uzbek title", () => {
  everywhere("uzbek title", [
    slide(
      "Sun'iy intellekt texnologiyalarining zamonaviy ta'lim tizimida qo'llanilishi va uning kelajakdagi istiqbollari",
      "title_body",
      { body: "Mavzu aniq tuzilma orqali yoritiladi.", bullets: ["Birinchi", "Ikkinchi", "Uchinchi"] },
    ),
  ]);
});

test("2. a long English title", () => {
  everywhere("english title", [
    slide(
      "The Application of Artificial Intelligence Technologies in Contemporary Educational Systems",
      "title_body",
      { body: "The topic is presented through a clear structure.", bullets: ["First", "Second"] },
    ),
  ]);
});

test("3. a four-card slide", () => {
  everywhere("four cards", [
    slide("To'rt yo'nalish", "two_columns", {
      bullets: [
        "Avtomatlashtirish",
        "Individual ta'lim",
        "Real vaqt tahlili",
        "Ochiq ma'lumot",
      ],
      body: "Har bir yo'nalish alohida qiymat beradi.",
    }),
  ]);
});

test("4. a hero slide carrying a visual", () => {
  everywhere("hero with image", [
    slide("Yangi intellekt", "title_body", { subtitle: "Ta'lim uchun", body: "Qisqa izoh." }),
  ], {
    images: [{ slideIndex: 0, bucket: "generated-images", path: "a/b.png", provider: "openai", costUsd: 0 }],
  });
});

test("5. a split visual", () => {
  everywhere("split visual", [
    slide("Chapda matn, o'ngda tasvir", "comparison", {
      bullets: ["Birinchi tomon", "Ikkinchi tomon"],
      body: "Ikki yondashuv yonma-yon.",
    }),
  ], {
    images: [{ slideIndex: 0, bucket: "generated-images", path: "a/b.png", provider: "openai", costUsd: 0 }],
  });
});

test("6. a big statistic", () => {
  everywhere("big number", [
    slide("Natija", "statistic", {
      statistic: { value: "87%", label: "foydalanuvchilar vaqt tejalishini qayd etdi" },
    }),
  ]);
});

test("7. a dense academic slide", () => {
  everywhere("dense academic", [
    slide("Tadqiqot natijalari va ularning talqini", "title_body", {
      subtitle: "2023–2024 yillardagi ma'lumotlar asosida",
      body: "Tadqiqot uch bosqichda o'tkazildi va har bosqichda mustaqil o'lchov qo'llanildi.",
      bullets: [
        "Birinchi bosqichda 1 240 respondent qatnashdi",
        "Ikkinchi bosqich 18 oy davom etdi",
        "Uchinchi bosqichda nazorat guruhi qo'shildi",
        "Xatolik chegarasi 3,2 foizni tashkil etdi",
        "Natijalar 2024-yil mart oyida nashr etildi",
      ],
    }),
  ]);
});

test("8. a comparison", () => {
  everywhere("comparison", [
    slide("An'anaviy va raqamli yondashuv", "comparison", {
      bullets: ["An'anaviy: bir xil sur'at", "Raqamli: individual sur'at"],
      body: "Ikkalasi ham o'z o'rnida qo'llaniladi.",
    }),
  ]);
});

test("9. a timeline", () => {
  everywhere("timeline", [
    slide("Rivojlanish bosqichlari", "timeline", {
      bullets: ["1956 — atama paydo bo'ldi", "1997 — Deep Blue g'alabasi", "2012 — chuqur o'rganish", "2022 — generativ modellar"],
    }),
  ]);
});

test("10. a twelve-slide deck", () => {
  const deck = [
    slide("Sun'iy intellekt", "title_body", { subtitle: "Ta'limdagi o'rni", body: "Kirish." }),
    slide("Mavzular", "title_body", { bullets: ["Ta'rif", "Tarix", "Amaliyot"] }),
    slide("Ta'rif", "title_body", { body: "Sun'iy intellekt — mashinalarning o'rganish qobiliyati.", bullets: ["Mashinali o'rganish", "Chuqur o'rganish"] }),
    slide("Raqamlarda", "statistic", { statistic: { value: "68%", label: "o'qituvchilar vaqt tejadi" } }),
    slide("Taqsimot", "chart", { chart: { type: "donut", labels: ["A", "B", "C"], values: [48, 32, 20] } }),
    slide("To'rt afzallik", "two_columns", { bullets: ["Tezlik", "Aniqlik", "Moslashuv", "Narx"] }),
    slide("Amaliyotda", "title_body", { body: "Maktablarda joriy etish uch bosqichda kechadi.", bullets: ["Tayyorgarlik", "Sinov", "Kengaytirish"] }),
    slide("Taqqoslash", "comparison", { bullets: ["Avval", "Hozir"] }),
    slide("Bosqichlar", "timeline", { bullets: ["2020", "2022", "2024"] }),
    slide("Jadval", "table", { table: { columns: ["Yil", "Foiz"], rows: [["2023", "41"], ["2024", "68"]] } }),
    slide("Fikr", "quote", { quote: { text: "Ta'lim kelajakni yaratadi.", attribution: "Tadqiqotchi" } }),
    slide("Xulosa", "conclusion", { body: "Texnologiya o'qituvchini almashtirmaydi, unga vaqt beradi.", bullets: ["Vaqt tejaladi", "Sifat oshadi"] }),
  ];

  everywhere("twelve slides", deck, {
    images: [
      { slideIndex: 0, bucket: "generated-images", path: "a/0.png", provider: "openai", costUsd: 0 },
      { slideIndex: 6, bucket: "generated-images", path: "a/6.png", provider: "openai", costUsd: 0 },
    ],
  });
});

/* ------------------------------------------------- the budget's own claim */

test("copy written to a slot's budget fits that slot", () => {
  // The claim the whole change rests on: if a writer is told the box holds N
  // characters and writes N, it fits. Checked against every title slot in every
  // real design rather than against one sample.
  let checked = 0;

  for (const document of CORPUS) {
    for (const archetype of document.archetypes) {
      const brief = buildWritingBrief(document, archetype, { language: "uz" });
      for (const slot of brief.slots) {
        // Copy of exactly the preferred length, in words a writer would use.
        const filler = "Ta'lim tizimida yangi imkoniyatlar ochiladi va natija sezilarli ".repeat(20);
        const text = filler.slice(0, slot.budget.preferredCharacters).trim();
        if (text.length === 0) continue;

        const fit = checkFit(slot, text);
        assert.ok(
          fit.fits,
          `${document.design.slug}/${archetype.id}/${slot.elementId}: copy at the preferred budget did not fit `
            + `(${fit.characters} chars, ${fit.lines} lines, limit ${fit.maximumCharacters}/${fit.maximumLines})`,
        );
        checked += 1;
      }
    }
  }

  assert.ok(checked > 500, `the corpus should exercise hundreds of slots, checked ${checked}`);
});

/* ------------------------------------------------- a placed JElement ----- */

/**
 * An element on a slide reaches the exporters unchanged.
 *
 * The claim JElement rests on: what it emits is the same filled, rounded,
 * rotatable box the slide engine already draws, so the web view, the phone and
 * the PPTX exporter each handle it without being told the library exists. If
 * that were untrue it would be untrue here, where the rows are inspected in the
 * shape the exporters read.
 */
test("a placed element becomes rows the exporters already understand", () => {
  const document = CORPUS[0];
  const archetype = document.archetypes.find((entry) => entry.purpose === "title_content")
    ?? document.archetypes[0];

  // Two shapes, in the element's own 0-1 space, as `renderElement` produces.
  const drawn = [
    { x: 0.1, y: 0.3, width: 0.8, height: 0.4, rotation: 0, zIndex: 1, opacity: 1, style: { backgroundColor: "#101214", shape: "rect" } },
    { x: 0.3, y: 0.55, width: 0.2, height: 0.2, rotation: -8, zIndex: 2, opacity: 1, style: { backgroundColor: "#A7FF00", shape: "circle", borderRadius: 20 } },
  ];

  const imageSlot = archetype.elements.find((entry) => entry.type === "image" || entry.type === "frame");
  if (!imageSlot) return; // This design draws no pictures; nothing to fill.

  const withElementSlot = structuredClone(document);
  const target = withElementSlot.archetypes.find((entry) => entry.id === archetype.id);
  for (const entry of target.elements) {
    if (entry.type === "image" || entry.type === "frame") entry.strategy = "jelement";
  }

  const built = buildJslaydSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    design: readDesign({ id: "11110000-0000-4000-8000-000000000001", slug: document.design.slug, version: 1, compiled_config: withElementSlot }).design,
    slides: [slide("Konchilikda raqamli texnologiyalar", "title_body", { body: "Qisqa izoh.", bullets: ["Bir", "Ikki"] })],
    sources: [],
    generatedImages: [],
    uploadedImages: [],
    authorName: null,
    teacherName: null,
    paletteCode: null,
    archetypeIds: [archetype.id],
    slideElements: [{ [imageSlot.slot]: drawn }],
  });

  const placed = built.elements.filter((row) => row.content?.kind === "jelement");
  assert.equal(placed.length, 2, "both shapes reached the slide");

  for (const row of placed) {
    // Every exporter switches on `type`, and `shape` is one it already has.
    assert.equal(row.type, "shape", "no exporter needs a new element type");
    assert.equal(typeof row.style.backgroundColor, "string", "with a colour it can fill");
    assert.ok(Number.isFinite(row.x) && Number.isFinite(row.width), "and finite geometry");
    assert.ok(row.width > 0 && row.height > 0, "that a renderer can draw");
  }

  // Rotation survives, because a PPTX shape carries one and a lost angle is a
  // composition that silently straightens on export.
  assert.ok(placed.some((row) => row.rotation !== 0), "the angled component kept its angle");

  assertClean(built, "placed element");
});
