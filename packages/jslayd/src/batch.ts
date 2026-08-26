import { analyze, type HealthReport } from "./analyze.ts";
import { compile } from "./compile.ts";
import type { Diagnostic } from "./diagnostics.ts";
import type { JslaydDocument } from "./document.ts";

/**
 * Taking a hundred designs at once, and saying what is wrong with them first.
 *
 * One design at a time is how the studio has always worked, and it is the right
 * shape when somebody is writing one. It is the wrong shape for a batch: a
 * hundred pasted designs where the ninety-first has a typo should not be
 * ninety-one saves and a surprise, and it should certainly not be a partial
 * import nobody can see the shape of.
 *
 * So a batch is read, compiled and analysed **before** anything is written, and
 * what comes back is the report — how many are valid, what each invalid one got
 * wrong, and which of them will need a photograph or a data series at
 * generation time. Nothing here touches a database; the caller decides whether
 * the answer is good enough to commit.
 *
 * The compiler and the analyser are the existing ones. A batch that judged
 * designs by its own rules would be a second opinion about what JSLAYD means,
 * and the first time the two disagreed the studio would be lying to somebody.
 */

/** What a batch looks like on the wire: one envelope, many sources. */
export type BatchInput = {
  schemaVersion: number;
  slides: readonly { id?: string; name?: string; source: string }[];
};

export type BatchEntry = {
  /** Position in the submitted array, so a report line can be found again. */
  index: number;
  /** The name the design gave itself, or the one the envelope supplied. */
  name: string;
  valid: boolean;
  document: JslaydDocument | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  health: HealthReport | null;
  /** Families this design names that the shelf will have to provide. */
  fonts: string[];
  /** Slides that cannot be filled without a photograph. */
  needsImage: number;
  /** Slides that can carry a chart, a table or a set of figures. */
  dataCapable: number;
};

export type BatchReport = {
  total: number;
  valid: number;
  invalid: number;
  /** Valid designs carrying at least one warning — worth a look, not a block. */
  withWarnings: number;
  needsImage: number;
  dataCapable: number;
  /** Every distinct family named across the batch, sorted. */
  fonts: string[];
  entries: BatchEntry[];
};

const SCHEMA_VERSION = 1;

/**
 * Read the envelope, refusing anything that is not one rather than guessing.
 *
 * A batch arrives as pasted text, so the failure to plan for is a person
 * pasting one design into the box that wants a hundred. That is answered by
 * name — "this is a single design, use the other tab" — rather than by a schema
 * error mentioning `slides`.
 */
export function readBatch(text: string): { batch: BatchInput | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const looksLikeDesign = /^\s*JSLAYD-DESIGN/m.test(text);
    return {
      batch: null,
      error: looksLikeDesign
        ? "Bu bitta dizayn matni. Partiya uchun {\"schemaVersion\":1,\"slides\":[…]} ko‘rinishidagi JSON kerak."
        : "JSON o‘qilmadi.",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { batch: null, error: "Yuqori darajada obyekt kutilgan edi." };
  }
  const envelope = parsed as Record<string, unknown>;
  const version = Number(envelope.schemaVersion);
  if (version !== SCHEMA_VERSION) {
    return { batch: null, error: `schemaVersion ${SCHEMA_VERSION} kutilgan edi, ${envelope.schemaVersion ?? "yo‘q"} keldi.` };
  }
  if (!Array.isArray(envelope.slides) || envelope.slides.length === 0) {
    return { batch: null, error: "slides bo‘sh yoki massiv emas." };
  }

  const slides: BatchInput["slides"] = envelope.slides.map((entry, index) => {
    if (typeof entry === "string") return { source: entry };
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : undefined,
      name: typeof row.name === "string" ? row.name : undefined,
      source: typeof row.source === "string" ? row.source
        : typeof row.code === "string" ? row.code
          : `__missing_source_${index}__`,
    };
  });

  return { batch: { schemaVersion: version, slides }, error: null };
}

/** Every font family a document names, deduplicated. */
function fontsOf(document: JslaydDocument): string[] {
  const names = new Set<string>();
  for (const font of document.fonts) if (font.name) names.add(font.name);
  return [...names].sort();
}

function capability(document: JslaydDocument): { needsImage: number; dataCapable: number } {
  let needsImage = 0;
  let dataCapable = 0;
  for (const archetype of document.archetypes) {
    const rules = archetype.selection;
    if (rules.supportsImage) needsImage += 1;
    if (rules.supportsChart || rules.supportsTable || rules.supportsStats) dataCapable += 1;
  }
  return { needsImage, dataCapable };
}

/**
 * Compile and analyse everything, and write nothing.
 *
 * The dry run and the real import read the same function; the difference is
 * only what the caller does with the result. Anything else and the report is a
 * prediction of the import rather than a description of it.
 */
export function inspectBatch(batch: BatchInput): BatchReport {
  const entries: BatchEntry[] = batch.slides.map((slide, index) => {
    const result = compile(slide.source);
    const document = result.document;
    const health = document ? analyze(document) : null;
    const counts = document ? capability(document) : { needsImage: 0, dataCapable: 0 };

    return {
      index,
      name: document?.design.name || slide.name || slide.id || `#${index + 1}`,
      valid: Boolean(document) && result.diagnostics.errors.length === 0,
      document,
      errors: result.diagnostics.errors,
      warnings: result.diagnostics.warnings,
      health,
      fonts: document ? fontsOf(document) : [],
      ...counts,
    };
  });

  const fonts = [...new Set(entries.flatMap((entry) => entry.fonts))].sort();

  return {
    total: entries.length,
    valid: entries.filter((entry) => entry.valid).length,
    invalid: entries.filter((entry) => !entry.valid).length,
    withWarnings: entries.filter((entry) => entry.valid && entry.warnings.length > 0).length,
    needsImage: entries.reduce((sum, entry) => sum + entry.needsImage, 0),
    dataCapable: entries.reduce((sum, entry) => sum + entry.dataCapable, 0),
    fonts,
    entries,
  };
}

/** The report as the lines the studio prints above the import button. */
export function summarise(report: BatchReport): string[] {
  const lines = [
    `${report.valid} ta yaroqli`,
    `${report.invalid} ta xato`,
  ];
  if (report.withWarnings) lines.push(`${report.withWarnings} tasida ogohlantirish`);
  lines.push(`${report.needsImage} ta slayd rasm talab qiladi`);
  lines.push(`${report.dataCapable} ta slayd ma’lumot ko‘tara oladi`);
  lines.push(`${report.fonts.length} ta shrift oilasi kerak`);
  return lines;
}
