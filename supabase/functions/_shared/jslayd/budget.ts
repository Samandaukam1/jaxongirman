// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/budget.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import type { Archetype, JslaydDocument, JslaydElement, TextStyle } from "./document.ts";
import type { Binding } from "./spec.ts";
import { characterCapacity, charactersPerLine, densityFor, linesThatFit } from "./text-metrics.ts";

/**
 * What a writer needs to know before writing a word.
 *
 * The old order was: write the copy, choose a template, push the copy into it,
 * shrink the type until it stops overflowing. That produces a slide whose
 * design was decided by how much somebody happened to write, which is backwards
 * — and it is why decks came out with eleven-point body text beside a title on
 * four lines.
 *
 * This turns a chosen archetype into a brief: here is the box, here is the type
 * it is set in, here is roughly how much copy it holds, and here is how much of
 * that you should actually use. The geometry is not negotiable and is not sent
 * to be edited; a writer reads it the way a copywriter reads a layout.
 *
 * Nothing here is exact. `characterCapacity` is an estimate and says so, and
 * the renderer keeps its shrink pass for what the estimate misses. The point is
 * to be approximately right before writing rather than exactly right after.
 */

export type SlotRole =
  | "eyebrow" | "title" | "subtitle" | "body" | "bullets"
  | "quote" | "attribution" | "statistic_value" | "statistic_label"
  | "chart_title" | "table_title" | "references" | "page_number" | "meta";

export type TextSlotBudget = {
  elementId: string;
  binding: Binding;
  role: SlotRole;
  geometry: { x: number; y: number; width: number; height: number };
  typography: {
    font: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing: number;
    align: string;
    verticalAlign: string;
    transform: string;
    maxLines: number | null;
    minFontSize: number;
    overflow: string;
  };
  budget: {
    /** Aim for this. Leaves the whitespace the design was composed around. */
    preferredCharacters: number;
    /** Past this the estimate says it will not fit. */
    maximumCharacters: number;
    preferredWords: number;
    maximumWords: number;
    estimatedCharactersPerLine: number;
    estimatedLines: number;
    /** For a list: how many items the archetype will actually draw. */
    maximumItems?: number;
  };
  /** 1 is the loudest thing on the slide. Drives what gets cut first. */
  priority: number;
};

export type VisualZone = {
  elementId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArchetypeWritingBrief = {
  archetypeId: string;
  purpose: string;
  canvas: { width: number; height: number };
  slots: TextSlotBudget[];
  /** Where the pictures, charts and decoration sit. Copy works around these. */
  visualZones: VisualZone[];
};

/* ------------------------------------------------------------------- roles */

/**
 * The binding says what a slot is for; the element id does not.
 *
 * An id is whatever the designer typed — `t1`, `headline`, `big` — and guessing
 * a role from it is guessing. The binding is a closed vocabulary the compiler
 * validates, so it is the signal worth reading.
 */
const ROLE_BY_BINDING: Partial<Record<Binding, SlotRole>> = {
  section_label: "eyebrow",
  title: "title",
  subtitle: "subtitle",
  body: "body",
  bullets: "bullets",
  quote_text: "quote",
  quote_attribution: "attribution",
  stat_value: "statistic_value",
  stat_label: "statistic_label",
  stat_1: "statistic_value",
  stat_2: "statistic_value",
  stat_3: "statistic_value",
  chart_title: "chart_title",
  table_title: "table_title",
  sources: "references",
  page_number: "page_number",
};

/**
 * Bindings a writer must not be asked to fill.
 *
 * An author's name, the date and the page number are facts the server already
 * holds. Offering them as slots invites a model to invent a name.
 */
const NOT_WRITTEN = new Set<Binding>([
  "author", "teacher", "date", "brand", "page_number", "slide_count",
  "purpose", "sources", "chart_data", "table_data",
  "image_1", "image_2", "image_3",
]);

function roleOf(binding: Binding): SlotRole {
  return ROLE_BY_BINDING[binding] ?? "meta";
}

/**
 * Reading order, loudest first.
 *
 * Used two ways: it tells a writer which line carries the slide, and it decides
 * what gets compressed first when something has to give. A caption is cut
 * before a title.
 */
const PRIORITY: Record<SlotRole, number> = {
  title: 1,
  statistic_value: 1,
  quote: 1,
  subtitle: 2,
  body: 3,
  bullets: 3,
  statistic_label: 3,
  chart_title: 3,
  table_title: 3,
  eyebrow: 4,
  attribution: 4,
  references: 5,
  page_number: 6,
  meta: 5,
};

/* ------------------------------------------------------------------ budget */

/**
 * How much of the box to actually fill, by role.
 *
 * Never the whole thing. A title told it may use every character of its box
 * will use them, and the result is a headline touching all four edges of the
 * space the designer left air in. Whitespace is a design element and the
 * budget is where it gets defended — §9 of the brief, and the reason `preferred`
 * exists at all.
 *
 * `hard` is below the raw capacity too: the estimate has no idea whether the
 * copy is full of Ws.
 */
const FILL: Record<SlotRole, { preferred: number; hard: number }> = {
  title: { preferred: 0.60, hard: 0.85 },
  statistic_value: { preferred: 0.70, hard: 0.90 },
  quote: { preferred: 0.65, hard: 0.85 },
  subtitle: { preferred: 0.65, hard: 0.88 },
  body: { preferred: 0.72, hard: 0.90 },
  bullets: { preferred: 0.70, hard: 0.90 },
  statistic_label: { preferred: 0.70, hard: 0.90 },
  chart_title: { preferred: 0.65, hard: 0.88 },
  table_title: { preferred: 0.65, hard: 0.88 },
  eyebrow: { preferred: 0.70, hard: 0.90 },
  attribution: { preferred: 0.70, hard: 0.90 },
  references: { preferred: 0.85, hard: 0.95 },
  page_number: { preferred: 0.80, hard: 0.95 },
  meta: { preferred: 0.70, hard: 0.90 },
};

/** Mean characters per word including the space, close enough for a budget. */
const WORD_LENGTH = { uz: 7.4, ru: 7.0, en: 5.9 } as const;

function wordsFor(characters: number, language: string): number {
  const code = language.slice(0, 2).toLowerCase();
  const perWord = code === "en" ? WORD_LENGTH.en : code === "ru" ? WORD_LENGTH.ru : WORD_LENGTH.uz;
  return Math.max(1, Math.floor(characters / perWord));
}

function budgetFor(
  width: number,
  height: number,
  style: TextStyle,
  role: SlotRole,
  language: string,
): TextSlotBudget["budget"] {
  const capacity = characterCapacity(width, height, style);
  const density = densityFor(language);
  const fill = FILL[role];

  const maximumCharacters = Math.max(1, Math.floor(capacity * fill.hard * density));
  const preferredCharacters = Math.max(1, Math.min(
    maximumCharacters,
    Math.floor(capacity * fill.preferred * density),
  ));

  return {
    preferredCharacters,
    maximumCharacters,
    preferredWords: wordsFor(preferredCharacters, language),
    maximumWords: wordsFor(maximumCharacters, language),
    estimatedCharactersPerLine: charactersPerLine(width, style),
    estimatedLines: linesThatFit(height, style),
  };
}

/* ------------------------------------------------------------------- brief */

type Slotted = { id: string; binding: Binding; style: TextStyle; geometry: JslaydElement["geometry"]; maxItems?: number };

/** Every element that takes generated copy, flattened out of any groups. */
function writableSlots(elements: readonly JslaydElement[], offsetX = 0, offsetY = 0): Slotted[] {
  const found: Slotted[] = [];

  for (const element of elements) {
    const geometry = {
      ...element.geometry,
      x: element.geometry.x + offsetX,
      y: element.geometry.y + offsetY,
    };

    if (element.type === "group") {
      found.push(...writableSlots(element.children, geometry.x, geometry.y));
      continue;
    }

    if (element.type === "list") {
      found.push({ id: element.id, binding: element.source.bind, style: element.text, geometry, maxItems: element.maxItems });
      continue;
    }

    if (element.type === "stat") {
      // A stat is two slots in one element: the number and what it means.
      if ("bind" in element.value) {
        found.push({ id: `${element.id}.value`, binding: element.value.bind, style: element.valueStyle, geometry });
      }
      if (element.label && "bind" in element.label) {
        found.push({ id: `${element.id}.label`, binding: element.label.bind, style: element.labelStyle, geometry });
      }
      continue;
    }

    if (element.type === "text" || element.type === "quote" || element.type === "number" || element.type === "badge") {
      // A literal is the designer's own words — a fixed label, a brand mark.
      // It is not a slot, and offering it as one invites a model to rewrite
      // something that was decided on purpose.
      if ("bind" in element.source) {
        found.push({ id: element.id, binding: element.source.bind, style: element.text, geometry });
      }
      continue;
    }
  }

  return found;
}

/** Where the pictures and charts are, so the copy can be written around them. */
function visualZones(elements: readonly JslaydElement[], offsetX = 0, offsetY = 0): VisualZone[] {
  const zones: VisualZone[] = [];
  const VISUAL = new Set(["image", "chart", "table", "icon", "frame"]);

  for (const element of elements) {
    const geometry = {
      ...element.geometry,
      x: element.geometry.x + offsetX,
      y: element.geometry.y + offsetY,
    };
    if (element.type === "group") {
      zones.push(...visualZones(element.children, geometry.x, geometry.y));
      continue;
    }
    if (!VISUAL.has(element.type)) continue;
    zones.push({
      elementId: element.id,
      type: element.type,
      x: Math.round(geometry.x),
      y: Math.round(geometry.y),
      width: Math.round(geometry.width),
      height: Math.round(geometry.height),
    });
  }
  return zones;
}

/**
 * The brief for one slide, built from the archetype that will draw it.
 *
 * Small on purpose. This is sent to a model once per slide, and sending the
 * whole design document each time would cost more in tokens than the copy is
 * worth — the writer needs this slide's boxes, not the other twelve archetypes
 * or the colour families.
 */
export function buildWritingBrief(
  document: JslaydDocument,
  archetype: Archetype,
  options: { language?: string } = {},
): ArchetypeWritingBrief {
  const language = options.language ?? "uz";

  const slots = writableSlots(archetype.elements)
    .filter((slot) => !NOT_WRITTEN.has(slot.binding))
    .map((slot): TextSlotBudget => {
      const role = roleOf(slot.binding);
      return {
        elementId: slot.id,
        binding: slot.binding,
        role,
        geometry: {
          x: Math.round(slot.geometry.x),
          y: Math.round(slot.geometry.y),
          width: Math.round(slot.geometry.width),
          height: Math.round(slot.geometry.height),
        },
        typography: {
          font: slot.style.font,
          fontSize: slot.style.fontSize,
          fontWeight: slot.style.fontWeight,
          lineHeight: slot.style.lineHeight,
          letterSpacing: slot.style.letterSpacing,
          align: slot.style.align,
          verticalAlign: slot.style.verticalAlign,
          transform: slot.style.transform,
          maxLines: slot.style.maxLines,
          minFontSize: slot.style.minFontSize,
          overflow: slot.style.overflow,
        },
        budget: {
          ...budgetFor(slot.geometry.width, slot.geometry.height, slot.style, role, language),
          ...(slot.maxItems === undefined ? {} : { maximumItems: slot.maxItems }),
        },
        priority: PRIORITY[role],
      };
    })
    .sort((a, b) => a.priority - b.priority || a.geometry.y - b.geometry.y);

  return {
    archetypeId: archetype.id,
    purpose: archetype.purpose,
    canvas: { ...document.design.canvas },
    slots,
    visualZones: visualZones(archetype.elements),
  };
}

/**
 * Does this copy fit the slot it was written for?
 *
 * The same estimate the budget was built from, run the other way. A `false`
 * here is what triggers a rewrite — never a font change, which is the last
 * resort and the renderer's business, not the writer's.
 */
export type SlotFit = {
  elementId: string;
  fits: boolean;
  characters: number;
  maximumCharacters: number;
  lines: number;
  maximumLines: number | null;
  /** A last line holding one short word, which reads as a mistake. */
  orphan: boolean;
  overBy: number;
};

export function checkFit(slot: TextSlotBudget, text: string): SlotFit {
  const trimmed = text.trim();
  const perLine = slot.budget.estimatedCharactersPerLine;
  const maxLines = slot.typography.maxLines ?? slot.budget.estimatedLines;

  // Explicit breaks are the writer's own line decisions and are honoured; the
  // rest wraps at the estimated measure.
  const written = trimmed.split("\n");
  const lines = written.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0);

  const lastLine = written[written.length - 1] ?? "";
  const lastWords = lastLine.trim().split(/\s+/).filter(Boolean);
  const orphan = written.length > 1 && lastWords.length === 1 && lastLine.trim().length <= Math.max(6, perLine * 0.18);

  const characters = trimmed.length;
  return {
    elementId: slot.elementId,
    fits: characters <= slot.budget.maximumCharacters && lines <= maxLines && !orphan,
    characters,
    maximumCharacters: slot.budget.maximumCharacters,
    lines,
    maximumLines: maxLines,
    orphan,
    overBy: Math.max(0, characters - slot.budget.maximumCharacters),
  };
}
