import { looksLikePerson } from "./photo-order.ts";
import { normaliseName } from "./entity-match.ts";
import { namedSubject } from "./photo-query.ts";

/**
 * What kind of thing a slide is asking for a picture of.
 *
 * The routing depends on it entirely. A stock library is right for "modern
 * office" and catastrophic for "Sherzodxon Qudratxo'ja" — it answers both with
 * equal confidence, and only one of those answers is a real person's face on a
 * stranger's biography.
 *
 * Deterministic and free. Asking a model to classify would cost a call per
 * slide, take a second, and answer differently on Tuesday; the distinctions
 * that matter here are visible in the words themselves.
 */

export type ImageIntent =
  /** A named human. Identity must be proved; no picture is better than a wrong one. */
  | "exact_person"
  /** A named place, monument or geographic feature. */
  | "specific_place"
  /** A named building or venue. */
  | "specific_building"
  /** A named product or model. */
  | "specific_product"
  /** A named company, ministry, university or team. */
  | "organization"
  /** A named, dated happening. */
  | "specific_event"
  /** Anything a stock library can answer: a concept, a mood, an activity. */
  | "generic_concept";

/** Whether getting the wrong subject is a correctness failure or a weak slide. */
export const identityCritical = (intent: ImageIntent): boolean => intent === "exact_person";

/**
 * Words that say what kind of named thing this is.
 *
 * Uzbek and English together because a deck's topic is written in one and its
 * visual direction often in the other. Matched on the normalised text, so
 * `maydoni`, `Maydoni` and `maydonı` are one word.
 */
const MARKERS: ReadonlyArray<[ImageIntent, readonly string[]]> = [
  ["specific_place", [
    "maydoni", "maydon", "shahri", "shahar", "viloyati", "tumani", "koʻchasi", "kochasi",
    "bogʻi", "bogi", "parki", "koli", "daryosi", "togʻi", "togi", "choli",
    "square", "city", "region", "district", "street", "park", "lake", "river", "mountain", "desert",
  ]],
  ["specific_building", [
    "masjidi", "madrasasi", "maqbarasi", "qalasi", "saroyi", "binosi", "teatri", "muzeyi",
    "minorasi", "koʻprigi", "koprigi", "stadioni", "vokzali", "aeroporti",
    "mosque", "madrasah", "mausoleum", "fortress", "palace", "theatre", "theater", "museum",
    "tower", "bridge", "stadium", "station", "airport", "cathedral",
  ]],
  ["organization", [
    "universiteti", "instituti", "vazirligi", "kompaniyasi", "banki", "korxonasi",
    "akademiyasi", "markazi", "agentligi", "federatsiyasi", "klubi",
    "university", "institute", "ministry", "company", "bank", "academy", "agency",
    "federation", "club", "corporation", "foundation",
  ]],
  ["specific_event", [
    "konsert", "konserti", "festival", "festivali", "musobaqasi", "chempionati",
    "koʻrgazmasi", "korgazmasi", "forumi", "sammiti", "olimpiadasi", "urushi", "inqilobi",
    "concert", "festival", "championship", "exhibition", "forum", "summit", "olympics",
    "war", "revolution", "ceremony", "conference",
  ]],
];

/**
 * Makes and models: a capitalised word followed by a model-ish token.
 *
 * "Chevrolet Cobalt", "Apple Vision Pro", "iPhone 15" — the second part is what
 * separates a product from a company. A bare "Chevrolet" is an organisation.
 */
const PRODUCT_TAIL = /\b([A-Z][\p{L}]+\s+)?(pro|max|plus|ultra|mini|air|[A-Z][a-z]+\s?\d{1,4}|\d{2,4})\b/u;

/** Brands common enough that a bare mention is still about the product. */
const PRODUCT_MARKERS = new Set([
  "iphone", "ipad", "macbook", "airpods", "galaxy", "pixel", "tesla", "cobalt",
  "camry", "nexia", "malibu", "vision",
]);

export type IntentReading = {
  intent: ImageIntent;
  /** The named thing itself, without the scene words around it. */
  entity: string;
  /** Lowercased, apostrophe-folded — the cache key. */
  normalized: string;
};

/**
 * Read a query, and the slide around it where there is one.
 *
 * The slide's title carries the subject and the visual direction carries the
 * scene, so both are consulted: "Yulduz Usmonovaning konsert faoliyati" is a
 * person *and* an event, and which one wins decides whether a stage photograph
 * or a portrait is the right answer.
 */
export function readIntent(input: {
  query: string;
  title?: string | null;
  topic?: string | null;
}): IntentReading {
  const query = input.query.trim();
  const context = [input.title, input.topic, query].filter(Boolean).join(" ");
  const flat = normaliseName(context);

  const entity = namedSubject(query) || namedSubject(input.title ?? "") || namedSubject(input.topic ?? "") || query;
  const normalized = normaliseName(entity);

  /**
   * The marker words decide first, because a named thing is name-shaped
   * whatever kind of thing it is.
   *
   * "Chevrolet Cobalt", "Registon maydoni" and "Yulduz Usmonova konserti" are
   * all two capitalised words to a shape test, and all three would read as a
   * person. What separates them is a word that says what kind of thing is
   * meant, and that word is not always in the name itself — a slide titled
   * "Xalqaro konsert faoliyati" makes its subject an event.
   */
  const flatQuery = normaliseName(query);
  if (PRODUCT_TAIL.test(query) || [...PRODUCT_MARKERS].some((mark) => flatQuery.includes(mark))) {
    return { intent: "specific_product", entity, normalized };
  }

  const marked = MARKERS.find(([, words]) => words.some((word) => flat.includes(word)));
  if (marked) return { intent: marked[0], entity, normalized };

  /**
   * A person, where nothing said otherwise.
   *
   * Last among the named readings and first in consequence: everything above
   * is a weak slide when it is wrong, and this one is somebody else's face on
   * a stranger's biography.
   */
  if (looksLikePerson(entity)) return { intent: "exact_person", entity, normalized };

  if (namedSubject(query) || namedSubject(input.title ?? "")) {
    // A capitalised thing with no marker at all: an organisation is the safest
    // read, and it routes the way a place does — encyclopaedia first.
    return { intent: "organization", entity, normalized };
  }

  return { intent: "generic_concept", entity: query, normalized: normaliseName(query) };
}
