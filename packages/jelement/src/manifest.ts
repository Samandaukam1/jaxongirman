import { normalizeTerm, OBJECT_CLASSES, SLIDE_ROLES, toSlug, type ObjectClass, type SlideRole } from "./spec.ts";

/**
 * What comes back with a reference sheet: the names, in JSON.
 *
 * The library used to be described in an indented, sectioned language of its
 * own, and the language was the problem. It nested by leading spaces, chat
 * interfaces flatten leading spaces, and a specification pasted flat compiled
 * to twelve elements with nothing in them. That cost a day and produced a
 * library of empty squares.
 *
 * JSON has no such failure mode. Whitespace carries no meaning, a chat window
 * cannot break it, and every model on earth emits it correctly. It also cannot
 * describe geometry, which is now a feature rather than a loss: the drawing is
 * the render, and the only thing left to write down is what each object is
 * called and how somebody will look for it.
 *
 * Nothing here is lenient. A manifest that names eleven objects for a
 * twelve-cell sheet is a mismatch somebody has to see, not something to pad
 * with a placeholder.
 */

export type ManifestElement = {
  /** 1-based, in the sheet's reading order. */
  cell: number;
  canonicalName: string;
  displayName: string;
  objectClass: ObjectClass;
  /** The section within the family — kardiologiya, LOR, diagnostika. */
  group: string;
  /** False when the object's colour is part of what it is. */
  recolorable: boolean;
  aliases: string[];
  uzbekTerms: string[];
  englishTerms: string[];
  russianTerms: string[];
  concepts: string[];
  contexts: string[];
  industries: string[];
  slideRoles: SlideRole[];
};

export type Manifest = {
  family: {
    name: string;
    slug: string;
    category: string;
    subcategory: string;
    style: string;
    description: string;
  };
  grid: { columns: number; rows: number };
  colorTokens: Record<string, string>;
  elements: ManifestElement[];
};

export type ManifestResult = {
  manifest: Manifest | null;
  errors: string[];
  warnings: string[];
};

function strings(value: unknown, limit = 24): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, limit);
  }
  // A comma-separated string is what a model reaches for when the schema says
  // "list" and the example shows prose. Accepting it costs one line and saves a
  // round trip through another product.
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, limit);
  }
  return [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Reads a manifest, refusing anything that would produce a library nobody can
 * search.
 *
 * Uzbek terms are the one field whose absence is fatal rather than noted. The
 * product is used in Uzbek: an element with no Uzbek name is invisible to the
 * people it exists for, and a library of invisible elements is indistinguishable
 * from an empty one.
 */
export function readManifest(source: string): ManifestResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: unknown;
  try {
    // A model asked for JSON often wraps it in a fenced code block, and a
    // person pasting from chat brings the fence with them.
    const cleaned = source.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    raw = JSON.parse(cleaned);
  } catch {
    return { manifest: null, errors: ["JSON o'qilmadi — matn to'liq nusxalanganini tekshiring."], warnings };
  }

  const root = raw as Record<string, unknown> | null;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { manifest: null, errors: ["Manifest obyekt bo'lishi kerak."], warnings };
  }

  const familyRaw = (root.family ?? {}) as Record<string, unknown>;
  const name = text(familyRaw.name);
  if (!name) errors.push("`family.name` yo'q — oilaning nomi majburiy.");

  const slug = toSlug(text(familyRaw.slug, name));
  if (!slug) errors.push("`family.slug` hosil qilinmadi — nomda lotin harflari bo'lsin.");

  const gridRaw = (root.grid ?? {}) as Record<string, unknown>;
  const columns = Number(gridRaw.columns);
  const rows = Number(gridRaw.rows);
  if (!Number.isInteger(columns) || columns < 1 || columns > 8) errors.push("`grid.columns` 1–8 orasida butun son bo'lsin.");
  if (!Number.isInteger(rows) || rows < 1 || rows > 8) errors.push("`grid.rows` 1–8 orasida butun son bo'lsin.");

  const colorTokens: Record<string, string> = {};
  for (const [role, value] of Object.entries((root.colorTokens ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      colorTokens[role] = value.trim().toUpperCase();
    } else {
      warnings.push(`\`colorTokens.${role}\` HEX rang emas — e'tiborsiz qoldirildi.`);
    }
  }

  const list = Array.isArray(root.elements) ? root.elements : [];
  if (list.length === 0) errors.push("`elements` bo'sh.");

  const elements: ManifestElement[] = [];
  const seenCells = new Set<number>();
  const seenNames = new Set<string>();

  list.forEach((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const where = `elements[${index}]`;

    const canonicalName = text(item.canonicalName);
    if (!canonicalName) { errors.push(`${where}: \`canonicalName\` yo'q.`); return; }

    const normalized = normalizeTerm(canonicalName);
    if (seenNames.has(normalized)) errors.push(`${where}: "${canonicalName}" takrorlangan.`);
    seenNames.add(normalized);

    // Defaults to its position, because a model that omits `cell` has almost
    // always still returned them in order — and saying so beats refusing.
    const cell = Number.isInteger(Number(item.cell)) ? Number(item.cell) : index + 1;
    if (seenCells.has(cell)) errors.push(`${where}: ${cell}-katak ikki marta ishlatilgan.`);
    seenCells.add(cell);

    const uzbekTerms = strings(item.uzbekTerms);
    if (uzbekTerms.length === 0) {
      errors.push(`${where} ("${canonicalName}"): o'zbekcha atama yo'q — element o'zbekcha qidiruvda topilmaydi.`);
    }

    const objectClass = OBJECT_CLASSES.includes(text(item.objectClass) as ObjectClass)
      ? text(item.objectClass) as ObjectClass
      : "other";

    const slideRoles = strings(item.slideRoles).filter((role): role is SlideRole =>
      SLIDE_ROLES.includes(role as SlideRole));

    elements.push({
      cell,
      canonicalName,
      displayName: text(item.displayName, uzbekTerms[0] ?? canonicalName),
      objectClass,
      // `subcategory` is what the column has always been called; `group` is what
      // it is called in the manifest, because that is the word somebody
      // sectioning a library reaches for. Both are read, so neither is wrong.
      group: text(item.group, text(item.subcategory)),
      // Absent means yes. Most objects should follow the deck, and an analyzer
      // that forgets the field should not accidentally freeze a whole sheet.
      recolorable: item.recolorable !== false,
      aliases: strings(item.aliases),
      uzbekTerms,
      englishTerms: strings(item.englishTerms),
      russianTerms: strings(item.russianTerms),
      concepts: strings(item.concepts),
      contexts: strings(item.contexts),
      industries: strings(item.industries),
      slideRoles,
    });
  });

  if (Number.isInteger(columns) && Number.isInteger(rows) && elements.length > 0) {
    const cells = columns * rows;
    if (elements.length !== cells) {
      // Not a warning. A mismatch means the nth cut is not the nth element for
      // some n, and every element after that point is mislabelled.
      errors.push(`To'r ${columns}×${rows} = ${cells} ta katak, manifestda esa ${elements.length} ta element.`);
    }
    for (const element of elements) {
      if (element.cell < 1 || element.cell > cells) {
        errors.push(`"${element.canonicalName}": ${element.cell}-katak to'rdan tashqarida.`);
      }
    }
  }

  if (errors.length > 0) return { manifest: null, errors, warnings };

  return {
    manifest: {
      family: {
        name,
        slug,
        category: text(familyRaw.category),
        subcategory: text(familyRaw.subcategory),
        style: text(familyRaw.style),
        description: text(familyRaw.description),
      },
      grid: { columns, rows },
      colorTokens,
      // Sorted by cell, so the nth element is the nth cut whatever order the
      // model listed them in.
      elements: elements.sort((first, second) => first.cell - second.cell),
    },
    errors,
    warnings,
  };
}

/**
 * A manifest, in the shape the library already stores.
 *
 * Built here rather than server-side so the existing save path is reused
 * unchanged: the console has always sent a compiled family and the database has
 * always taken one, and a second entry point would be a second thing to keep
 * in step.
 *
 * Every element comes out as `rendering: "asset"` with no components, because
 * that is what these are — the drawing arrives as a picture and is attached
 * afterwards. The geometry block is filled with the identity values a renderer
 * needs and nothing more: a picture occupies its whole box, so its bounds are
 * its box and its centre is the middle.
 */
export function manifestToFamily(manifest: Manifest): Record<string, unknown> {
  const unitBox = { x: 0, y: 0, width: 1, height: 1 };

  return {
    format: "JELEMENT",
    version: "1.0",
    family: {
      name: manifest.family.name,
      slug: manifest.family.slug,
      category: manifest.family.category,
      subcategory: manifest.family.subcategory,
      style: manifest.family.style,
      description: manifest.family.description,
    },
    visualDNA: {
      material: "", lighting: "", edgeStyle: "", depthStyle: "", perspective: "",
      camera: "", shadowStyle: "", highlightStyle: "", detailDensity: 5,
      realism: "rendered CGI", geometryLanguage: "",
    },
    colorTokens: manifest.colorTokens,
    search: {
      keywords: [...new Set(manifest.elements.flatMap((element) => element.uzbekTerms))].slice(0, 40),
      industries: [...new Set(manifest.elements.flatMap((element) => element.industries))].slice(0, 20),
      concepts: [...new Set(manifest.elements.flatMap((element) => element.concepts))].slice(0, 40),
    },
    elements: manifest.elements.map((element, index) => ({
      index,
      canonicalName: element.canonicalName,
      displayName: element.displayName,
      objectClass: element.objectClass,
      category: manifest.family.category,
      subcategory: element.group || manifest.family.subcategory,
      rendering: "asset",
      semantic: {
        aliases: element.aliases,
        uzbekTerms: element.uzbekTerms,
        englishTerms: element.englishTerms,
        russianTerms: element.russianTerms,
        industries: element.industries,
        concepts: element.concepts,
        actions: [],
        contexts: element.contexts,
      },
      geometry: {
        // Replaced by the crop's real ratio when the picture is attached.
        aspectRatio: 1,
        bounds: unitBox,
        visualBounds: unitBox,
        safeBounds: unitBox,
        visualCenter: { x: 0.5, y: 0.5 },
        dominantAxis: "balanced",
        originalRotation: 0,
        naturalFacing: "neutral",
        anchors: {},
        components: [],
      },
      appearance: {
        materials: [], roughness: 0.5, metalness: 0.5, edgeSoftness: 0.3,
        shadowDirection: "", highlightDirection: "", emissiveAreas: [],
      },
      usage: {
        slideRoles: element.slideRoles.length > 0 ? element.slideRoles : ["supporting"],
        bestFor: [], avoidFor: [],
        visualWeight: 5, detailDensity: 5, recommendedMaxSlideCoverage: 0.35,
      },
      transform: {
        scalable: true, rotatable: true, recolorable: true, flipHorizontal: true,
      },
    })),
  };
}
