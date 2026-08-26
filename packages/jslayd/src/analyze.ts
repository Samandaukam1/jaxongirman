import { contrastRatio, resolveColor } from "./colors.ts";
import type {
  ColorFamily,
  ColorValue,
  Gradient,
  JslaydDocument,
  JslaydElement,
  TextStyle,
} from "./document.ts";
import { DiagnosticBag, type Diagnostic } from "./diagnostics.ts";
import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_READABLE_FONT_SIZE } from "./spec.ts";
import { buildWritingBrief } from "./budget.ts";
import { cellCapacity, characterCapacity } from "./text-metrics.ts";

/**
 * The design health analyzer (§92).
 *
 * Deterministic and offline: every check is arithmetic over the compiled
 * document. It never asks a model anything, so the same design always scores
 * the same — which is the only way a score is worth showing an admin.
 *
 * It runs after a successful compile and cannot block one. Its job is to catch
 * the class of mistake that is valid JSLAYD and still a bad slide: copy that
 * cannot fit, type that cannot be read on its own ground, a chart palette
 * shorter than the data it will meet.
 */

export type CheckName = "schema" | "fonts" | "overflow" | "contrast" | "charts" | "tables" | "assets";

export type CheckResult = {
  name: CheckName;
  label: string;
  passed: boolean;
  /** 0–100 for this check alone. */
  score: number;
  findings: Diagnostic[];
};

export type HealthReport = {
  score: number;
  checks: CheckResult[];
  findings: Diagnostic[];
};

const LABELS: Record<CheckName, string> = {
  schema: "Sxema",
  fonts: "Shriftlar",
  overflow: "Sig'imi",
  contrast: "Kontrast",
  charts: "Diagrammalar",
  tables: "Jadvallar",
  assets: "Fayllar",
};

/**
 * The smallest amount of room in which each kind of copy is still writable.
 *
 * These are floors, not targets, and the difference matters. Measured across
 * the fifteen-design corpus, the median title slot holds 21 characters and a
 * tenth hold 11 or fewer — because a display title set large *is* a short box,
 * and the writer is told its budget and writes inside it. A floor set at what a
 * title deserves would flag half of every design ever published, and a warning
 * that fires on everything is one nobody reads.
 *
 * So each number is the point below which the slot stops being usable rather
 * than merely tight: under twelve characters there is no title that names a
 * subject, "Suv tejash" being ten. What a slot this small costs is the writing
 * — every deck gets two words where the topic needed five — which is invisible
 * in a preview, because placeholder copy is short by nature, and obvious in the
 * first real deck.
 */
const WANTS = new Map<string, number>([
  ["section_label", 4],
  ["title", 12], ["chart_title", 12], ["table_title", 12],
  ["subtitle", 12],
  ["body", 60],
  ["bullets", 80],
  ["bullet_1", 15], ["bullet_2", 15], ["bullet_3", 15],
  ["bullet_4", 15], ["bullet_5", 15], ["bullet_6", 15],
  ["quote_text", 40], ["quote_attribution", 10],
  ["stat_label", 8],
]);

/** Types whose geometry may bleed past the canvas on purpose (§18). */
const MAY_BLEED = new Set(["shape", "decorative", "divider", "line", "image", "frame", "icon", "group"]);

export function analyze(document: JslaydDocument): HealthReport {
  const checks: CheckResult[] = [
    run("fonts", (bag) => checkFonts(document, bag)),
    run("overflow", (bag) => checkOverflow(document, bag)),
    run("contrast", (bag) => checkContrast(document, bag)),
    run("charts", (bag) => checkCharts(document, bag)),
    run("tables", (bag) => checkTables(document, bag)),
    run("assets", (bag) => checkAssets(document, bag)),
  ];
  // Reaching the analyzer at all means the compiler produced a document, so the
  // schema check is a statement of fact rather than another pass.
  checks.unshift({ name: "schema", label: LABELS.schema, passed: true, score: 100, findings: [] });

  const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
  return { score, checks, findings: checks.flatMap((check) => check.findings) };
}

function run(name: CheckName, body: (bag: DiagnosticBag) => void): CheckResult {
  const bag = new DiagnosticBag();
  body(bag);
  const findings = bag.collect().all;
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  // Errors cost four times a warning; three errors is already a failing check.
  const score = Math.max(0, 100 - errors * 25 - warnings * 6);
  return { name, label: LABELS[name], passed: errors === 0, score, findings };
}

/* ------------------------------------------------------------------ checks */

function checkFonts(document: JslaydDocument, bag: DiagnosticBag): void {
  const declared = new Map(document.fonts.map((font) => [font.id, font]));
  const used = new Set<string>();
  for (const archetype of document.archetypes) {
    for (const element of flatten(archetype.elements)) {
      for (const style of stylesOf(element)) used.add(style.font);
      if (element.type === "chart") used.add(element.font);
      if (element.type === "table") {
        used.add(element.table.headerFont);
        used.add(element.table.cellFont);
      }
    }
  }
  for (const id of used) {
    const font = declared.get(id);
    if (!font) {
      bag.error("undeclared_font", `Element e'lon qilinmagan shriftni so'rayapti: \`${id}\`.`, 0);
      continue;
    }
    if (font.faces.length === 0) {
      bag.warn("font_asset_missing", `\`${font.id}\` (${font.name}) uchun fayl yuklanmagan.`, 0, `Zaxira sifatida ${font.fallback} chiziladi.`);
    }
  }
  for (const font of document.fonts) {
    if (used.has(font.id)) continue;
    bag.info("unused_font", `\`${font.id}\` (${font.name}) hech qayerda ishlatilmagan.`, 0);
  }
  if (document.fonts.some((font) => font.faces.length > 0)) {
    bag.info(
      "pptx_font_substitution",
      "PPTX eksportida maxsus shrift ochuvchining kompyuterida almashtirilishi mumkin.",
      0,
      "PowerPoint shriftni nomi bo'yicha topadi; fayl taqdimotga joylanmaydi.",
    );
  }
}

function checkOverflow(document: JslaydDocument, bag: DiagnosticBag): void {
  for (const archetype of document.archetypes) {
    /**
     * The writer's own budget, not a second estimate of it.
     *
     * `characterCapacity` is how much text the box could physically hold;
     * what the writer is given is that number after the fill factor and the
     * language's density, and it is meaningfully smaller. Comparing against
     * the raw capacity would understate how tight a box is — and would report
     * a different number from the one the sample slide is written to, which is
     * the fastest way to make an author distrust both.
     */
    const budgets = new Map<string, number>();
    try {
      for (const slot of buildWritingBrief(document, archetype).slots) {
        const seen = budgets.get(slot.elementId);
        if (seen === undefined || slot.budget.maximumCharacters < seen) {
          budgets.set(slot.elementId, slot.budget.maximumCharacters);
        }
      }
    } catch {
      // A design the brief cannot measure is one the other checks will fail on
      // their own terms; this check simply says nothing about it.
    }

    bag.within(archetype.id, () => {
      for (const element of flatten(archetype.elements)) {
        const source = (element as { source?: { bind?: string } }).source;
        const binding = typeof source?.bind === "string" ? source.bind : null;
        const { x, y, width, height } = element.geometry;
        const outside = x < 0 || y < 0 || x + width > CANVAS_WIDTH || y + height > CANVAS_HEIGHT;
        if (outside && !MAY_BLEED.has(element.type)) {
          bag.error(
            "out_of_canvas",
            `\`${element.id}\` kanvasdan chiqib ketgan (${Math.round(x)}, ${Math.round(y)}, ${Math.round(width)}×${Math.round(height)}).`,
            0,
            `Kanvas ${CANVAS_WIDTH}×${CANVAS_HEIGHT}. Matn kesilib qoladi.`,
          );
        }

        for (const style of stylesOf(element)) {
          if (style.fontSize < MIN_READABLE_FONT_SIZE) {
            bag.warn("small_type", `\`${element.id}\` matni juda mayda (${style.fontSize}).`, 0, `Kanonik kanvasda ${MIN_READABLE_FONT_SIZE} dan kichik matn o'qilmaydi.`);
          }
          if (style.overflow === "shrink" && style.minFontSize < MIN_READABLE_FONT_SIZE) {
            bag.warn(
              "shrink_below_readable",
              `\`${element.id}\` matni ${style.minFontSize} gacha kichrayishi mumkin.`,
              0,
              `\`minFontSize\` ni kamida ${MIN_READABLE_FONT_SIZE} qiling yoki blokni kattalashtiring.`,
            );
          }
          // A stat value or a display number is short by nature — "68%" needs
          // three glyphs, not a paragraph's worth — so the floor follows what
          // the element is for rather than one number for every kind of copy.
          const floor = element.type === "stat" || element.type === "number" ? 3 : 12;
          const capacity = characterCapacity(element.geometry.width, element.geometry.height, style);
          if (capacity < floor) {
            bag.error("no_room_for_text", `\`${element.id}\` bloki matn uchun juda kichik (taxminan ${capacity} belgi).`, 0);
            continue;
          }

          /**
           * Room for text is not the same as room for *this* text.
           *
           * The floor above asks whether anything at all fits. A title box that
           * holds fourteen characters clears it and still cannot hold a title:
           * "Suv resurslarini tejash" is twenty-three, and every deck generated
           * from that design arrives with its heading cut in half.
           *
           * The numbers below are what the binding is actually for, measured
           * against real Uzbek copy rather than chosen to be safe. A warning
           * rather than an error because a design may deliberately want a short
           * label in a small plate — but the author should be told, at the
           * moment they can still widen the box, rather than by a customer.
           */
          const wanted = binding ? WANTS.get(binding) : undefined;
          const budget = budgets.get(element.id) ?? capacity;
          if (wanted !== undefined && budget < wanted) {
            bag.warn(
              "tight_for_binding",
              `\`${element.id}\` ${binding} uchun tor: ${budget} belgi (${wanted} kerak).`,
              0,
              // Not "the text gets cut": the writer is told this limit and
              // writes to it. What the box costs is the heading itself — two
              // words where the topic needed five.
              "Matn kesilmaydi — yozuvchi shu chegarada yozadi. Lekin bu qutiga to‘liq fikr sig‘maydi: blokni kengaytiring yoki keglni kichraytiring.",
            );
          }
        }
      }
    });
  }
}

function checkContrast(document: JslaydDocument, bag: DiagnosticBag): void {
  for (const archetype of document.archetypes) {
    bag.within(archetype.id, () => {
      const elements = flatten(archetype.elements);
      for (const element of elements) {
        for (const style of stylesOf(element)) {
          const foreground = resolveColor(style.color, document.colors);
          const background = groundUnder(element, elements, archetype.background, document.colors);
          const ratio = contrastRatio(foreground, background);
          // 3:1 is WCAG's large-text floor and slide type is large by nature;
          // below 2 the words stop being separable from their ground at all.
          if (ratio < 2) {
            bag.error(
              "contrast_unreadable",
              `\`${element.id}\` matni fon bilan qo'shilib ketgan (${foreground} / ${background}, ${ratio.toFixed(2)}:1).`,
              0,
              "Matn yoki fon rangini o'zgartiring.",
            );
          } else if (ratio < 3) {
            bag.warn(
              "contrast_low",
              `\`${element.id}\` matni kontrasti past (${ratio.toFixed(2)}:1).`,
              0,
              "Katta matn uchun tavsiya etilgan eng kichik nisbat 3:1.",
            );
          }
        }
      }
    });
  }
}

/**
 * The colour actually behind an element: the topmost solid fill that covers it
 * and sits below it, or the slide ground. Gradients are read at their first
 * stop, which is the worst case an author is most likely to have overlooked.
 */
function groundUnder(
  element: JslaydElement,
  siblings: readonly JslaydElement[],
  slideBackground: ColorValue | Gradient,
  family: ColorFamily,
): string {
  const box = element.geometry;
  let ground = paintToHex(slideBackground, family);
  let bestZ = -Infinity;
  for (const candidate of siblings) {
    if (candidate.id === element.id) continue;
    if (!("fill" in candidate) || !candidate.fill) continue;
    if (candidate.geometry.zIndex >= box.zIndex || candidate.geometry.zIndex < bestZ) continue;
    if (candidate.opacity < 0.85) continue;
    const covers =
      candidate.geometry.x <= box.x &&
      candidate.geometry.y <= box.y &&
      candidate.geometry.x + candidate.geometry.width >= box.x + box.width &&
      candidate.geometry.y + candidate.geometry.height >= box.y + box.height;
    if (!covers) continue;
    bestZ = candidate.geometry.zIndex;
    ground = paintToHex(candidate.fill, family);
  }
  return ground;
}

function paintToHex(paint: ColorValue | Gradient, family: ColorFamily): string {
  if ("stops" in paint) return paintToHex(paint.stops[0]!.color, family);
  return resolveColor(paint, family);
}

function checkCharts(document: JslaydDocument, bag: DiagnosticBag): void {
  for (const archetype of document.archetypes) {
    for (const element of flatten(archetype.elements)) {
      if (element.type !== "chart") continue;
      const palette = element.palette ?? document.chartPalette;
      if (palette.length < 3) {
        bag.warn(
          "short_chart_palette",
          `\`${element.id}\` uchun palitrada ${palette.length} ta rang bor.`,
          0,
          "Uch va undan ko'p qiymatli diagrammada ranglar takrorlanadi.",
        );
      }
      if (element.style.showLabels && element.geometry.height < element.labelSize * 3) {
        bag.warn("chart_labels_cramped", `\`${element.id}\` yorliqlari uchun joy yetmaydi.`, 0, "Balandlikni oshiring yoki `showLabels: false` qiling.");
      }
      if (element.style.showValues && element.style.showLabels && element.geometry.width < 320) {
        bag.info("chart_dense", `\`${element.id}\` tor — yorliq va qiymat birga sig'masligi mumkin.`, 0);
      }
    }
  }
}

function checkTables(document: JslaydDocument, bag: DiagnosticBag): void {
  for (const archetype of document.archetypes) {
    for (const element of flatten(archetype.elements)) {
      if (element.type !== "table") continue;
      const rowHeight = element.table.cellSize * 1.4 + element.table.padding * 2;
      const capacity = Math.floor(element.geometry.height / rowHeight);
      const needed = element.rows + (element.header ? 1 : 0);
      if (capacity < needed) {
        bag.error(
          "table_overflow",
          `\`${element.id}\` jadvali ${needed} qatorga sig'maydi (taxminan ${Math.max(0, capacity)} ta joy bor).`,
          0,
          "Balandlikni oshiring, `cellSize` yoki `padding` ni kamaytiring.",
        );
      }
      const columnWidth = element.geometry.width / element.columns;
      const charsPerCell = cellCapacity(columnWidth, element.table.padding, element.table.cellSize);
      if (charsPerCell < 6) {
        bag.warn("table_columns_narrow", `\`${element.id}\` ustunlariga taxminan ${Math.max(0, charsPerCell)} belgi sig'adi.`, 0, "Ustun sonini kamaytiring yoki kengaytiring.");
      }
    }
  }
}

function checkAssets(document: JslaydDocument, bag: DiagnosticBag): void {
  const slots = new Map<string, number>();
  for (const archetype of document.archetypes) {
    for (const element of flatten(archetype.elements)) {
      if (element.type !== "image" && element.type !== "frame") continue;
      slots.set(element.slot, (slots.get(element.slot) ?? 0) + 1);
      if (element.strategy === "none" && element.required) {
        bag.error("impossible_image", `\`${element.id}\`: \`imageRequired\` va \`sourceStrategy: none\` bir vaqtda.`, 0);
      }
      if (element.strategy === "internet_search" && element.queryFrom.length === 0) {
        bag.warn("no_query_source", `\`${element.id}\` uchun qidiruv manbasi ko'rsatilmagan.`, 0);
      }
      if (element.required && element.when === "noImage") {
        bag.error("contradictory_condition", `\`${element.id}\`: \`when: noImage\` bo'lgan element rasm talab qilyapti.`, 0);
      }
    }
  }
  const purposes = new Set(document.archetypes.map((archetype) => archetype.purpose));
  for (const required of ["cover", "conclusion"] as const) {
    if (purposes.has(required)) continue;
    bag.warn("missing_purpose", `Dizaynda \`${required}\` maqsadli arxetip yo'q.`, 0, "Generator uni boshqa arxetip bilan almashtiradi.");
  }
  const variants = new Map<string, number>();
  for (const archetype of document.archetypes) {
    variants.set(archetype.purpose, (variants.get(archetype.purpose) ?? 0) + 1);
  }
  for (const [purpose, count] of variants) {
    if (purpose === "cover" || purpose === "thank_you" || count > 1) continue;
    bag.info("single_variant", `\`${purpose}\` uchun bitta variant bor.`, 0, "Ikki-uch variant taqdimotda takrorlanishni kamaytiradi.");
  }
}

/* ----------------------------------------------------------------- helpers */

/**
 * Every element with absolute geometry.
 *
 * Group children are stored relative to their group, so the walk translates
 * them back — a bounds check on a relative coordinate would measure the wrong
 * box entirely.
 */
function flatten(elements: readonly JslaydElement[], offsetX = 0, offsetY = 0): JslaydElement[] {
  const flat: JslaydElement[] = [];
  for (const element of elements) {
    const placed = offsetX === 0 && offsetY === 0
      ? element
      : { ...element, geometry: { ...element.geometry, x: element.geometry.x + offsetX, y: element.geometry.y + offsetY } };
    flat.push(placed);
    if (element.type === "group") {
      flat.push(...flatten(element.children, placed.geometry.x, placed.geometry.y));
    }
  }
  return flat;
}

function stylesOf(element: JslaydElement): TextStyle[] {
  if ("text" in element && element.text) return [element.text];
  if (element.type === "stat") return [element.valueStyle, element.labelStyle];
  return [];
}
