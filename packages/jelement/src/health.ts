import type { JElement, JElementFamily } from "./document.ts";
import { MIN_PREVIEW_SIZES, PREVIEW_ROTATIONS } from "./spec.ts";

/**
 * How good an element actually is, and where it falls short.
 *
 * A number on its own is a way of hiding problems: "78/100" tells an admin
 * something is wrong and nothing about what. So the score is always returned
 * with the deductions that produced it, and the admin page shows those rather
 * than the total.
 *
 * The dimensions are the brief's, and their weights say what the library is
 * for. Search metadata is worth as much as geometry because an element nobody
 * can find is worth nothing however well it is drawn — and this library is used
 * in Uzbek, so an element with no Uzbek terms loses most of that dimension.
 */

export type HealthDeduction = {
  dimension: string;
  points: number;
  reason: string;
  /** What to change. Absent when the fix is obvious from the reason. */
  fix?: string;
};

export type HealthReport = {
  score: number;
  dimensions: Record<string, { earned: number; possible: number }>;
  deductions: HealthDeduction[];
};

const WEIGHTS = {
  geometry: 20,
  search: 20,
  recolorability: 15,
  renderStability: 20,
  semantics: 15,
  mobile: 10,
} as const;

/**
 * Geometry: can a renderer draw this, and will it land where it should?
 *
 * The visual bounds carry most of the weight. A bounding box is what the maths
 * says and the visual bounds are where the mass reads; an element that never
 * distinguishes them is one that will look off-centre on every slide, and no
 * amount of component detail fixes that.
 */
function checkGeometry(element: JElement, out: HealthDeduction[]): number {
  const { geometry } = element;
  let earned: number = WEIGHTS.geometry;

  if (geometry.components.length === 0) {
    // The whole dimension, because there is no drawing. This used to cost
    // twelve points of a hundred, on the theory that such an element "ships as
    // an asset" — but `JElement` has no asset field, so what it actually ships
    // as is nothing.
    earned = 0;
    out.push({
      dimension: "geometry", points: WEIGHTS.geometry,
      reason: "Geometriya komponentlari yo'q — bu elementni hech narsa chiza olmaydi.",
      fix: "`components:` ostiga kamida bitta shakl yozing. Chekinishlarga e'tibor bering: chekintirilmagan qatorlar blokka kirmaydi.",
    });
    return earned;
  }

  if (geometry.components.length < 3) {
    earned -= 4;
    out.push({
      dimension: "geometry", points: 4,
      reason: `Atigi ${geometry.components.length} ta komponent — silueti sodda bo'lib qolishi mumkin.`,
    });
  }

  const sameAsBounds =
    geometry.visualBounds.x === geometry.bounds.x &&
    geometry.visualBounds.y === geometry.bounds.y &&
    geometry.visualBounds.width === geometry.bounds.width &&
    geometry.visualBounds.height === geometry.bounds.height;

  if (sameAsBounds) {
    earned -= 5;
    out.push({
      dimension: "geometry", points: 5,
      reason: "Vizual chegaralar to'rtburchak bilan bir xil.",
      fix: "Ko'z ko'radigan massani ayting — aks holda element har slaydda markazdan siljigan ko'rinadi.",
    });
  }

  if (geometry.aspectRatio <= 0 || !Number.isFinite(geometry.aspectRatio)) {
    earned -= 3;
    out.push({ dimension: "geometry", points: 3, reason: "Tomonlar nisbati aniqlanmagan." });
  }

  // A component outside the element's own space is one the renderer will place
  // outside the slot, which reads as a bug rather than as a bleed.
  const escaping = geometry.components.filter((component) =>
    component.box.x < -0.02 || component.box.y < -0.02 ||
    component.box.x + component.box.width > 1.02 ||
    component.box.y + component.box.height > 1.02);

  if (escaping.length > 0) {
    earned -= 4;
    out.push({
      dimension: "geometry", points: 4,
      reason: `${escaping.length} ta komponent element chegarasidan chiqib ketgan.`,
      fix: "Komponent qutilari 0–1 oralig'ida bo'lishi kerak.",
    });
  }

  return Math.max(0, earned);
}

/** Search: can anybody find this, in the language they are working in? */
function checkSearch(element: JElement, out: HealthDeduction[]): number {
  const { semantic } = element;
  let earned: number = WEIGHTS.search;

  // Half the dimension, and defensibly so: the planner builds its queries from
  // the slide's own copy, which is Uzbek. An element with no Uzbek terms is not
  // merely harder to find — it is very nearly unfindable in the only language
  // the queries arrive in.
  if (semantic.uzbekTerms.length === 0) {
    earned -= 10;
    out.push({
      dimension: "search", points: 10,
      reason: "O'zbekcha atamalar yo'q.",
      fix: "Kutubxona o'zbek tilida ishlatiladi — bu element o'zbekcha qidiruvda umuman topilmaydi.",
    });
  } else if (semantic.uzbekTerms.length === 1) {
    earned -= 2;
    out.push({ dimension: "search", points: 2, reason: "Bitta o'zbekcha atama — sinonimlar qo'shilsa topilishi osonlashadi." });
  }

  if (semantic.aliases.length === 0 && semantic.englishTerms.length === 0) {
    earned -= 4;
    out.push({ dimension: "search", points: 4, reason: "Boshqacha nomlar yo'q — faqat rasmiy nomi bilan topiladi." });
  }

  // Concepts are what let a presentation about "mining automation" find an
  // inspection drone nobody ever called an automation device.
  if (semantic.concepts.length === 0 && semantic.contexts.length === 0) {
    earned -= 6;
    out.push({
      dimension: "search", points: 6,
      reason: "Konsept va kontekst atamalari yo'q.",
      fix: "Element nima uchun ishlatilishini yozing — mavzu bo'yicha qidiruv shular orqali ishlaydi.",
    });
  }

  if (semantic.industries.length === 0) {
    earned -= 2;
    out.push({ dimension: "search", points: 2, reason: "Soha ko'rsatilmagan." });
  }

  return Math.max(0, earned);
}

/** Recolouring: does changing the family's accent actually reach this? */
function checkRecolorability(element: JElement, family: JElementFamily, out: HealthDeduction[]): number {
  let earned: number = WEIGHTS.recolorability;
  const components = element.geometry.components;
  // Nothing to inspect is not a pass. An element with no components cannot be
  // recoloured and cannot render stably, because it cannot render; awarding
  // this dimension in full is how thirteen undrawable elements scored 83/100.
  if (components.length === 0) return 0;

  const bound = components.filter((component) => component.fill !== null);
  if (bound.length === 0) {
    earned -= 10;
    out.push({
      dimension: "recolorability", points: 10,
      reason: "Hech bir komponent rang roliga bog'lanmagan.",
      fix: "Oila rangini o'zgartirganda bu element o'zgarmaydi.",
    });
    return Math.max(0, earned);
  }

  const undefinedTokens = bound.filter((component) => family.colorTokens[component.fill!] === undefined);
  if (undefinedTokens.length > 0) {
    earned -= 8;
    out.push({
      dimension: "recolorability", points: 8,
      reason: `${undefinedTokens.length} ta komponent oila belgilamagan rolga bog'langan.`,
      fix: "Bu shakllar rangsiz chiziladi.",
    });
  }

  // Everything locked is as bad as nothing bound: the element cannot follow a
  // rebrand at all.
  const recolorable = bound.filter((component) => component.recolorable);
  if (recolorable.length === 0) {
    earned -= 6;
    out.push({
      dimension: "recolorability", points: 6,
      reason: "Barcha qatlamlar ranglashdan qulflangan.",
      fix: "Oyna va xavfsizlik ranglaridan tashqari qatlamlar ranglanadigan bo'lsin.",
    });
  }

  return Math.max(0, earned);
}

/**
 * Render stability: does it survive being small, rotated and put on either
 * background?
 *
 * A component thinner than a hairline at preview size disappears; a colour with
 * no contrast against either ground disappears on one of them. Both are the
 * kind of failure nobody sees until a real deck is exported.
 */
function checkRenderStability(element: JElement, out: HealthDeduction[]): number {
  let earned: number = WEIGHTS.renderStability;
  const components = element.geometry.components;
  // Nothing to inspect is not a pass. An element with no components cannot be
  // recoloured and cannot render stably, because it cannot render; awarding
  // this dimension in full is how thirteen undrawable elements scored 83/100.
  if (components.length === 0) return 0;

  const smallest = MIN_PREVIEW_SIZES[0]!;
  const vanishing = components.filter(
    (component) => component.box.width * smallest < 1.5 || component.box.height * smallest < 1.5,
  );
  if (vanishing.length > 0) {
    earned -= 7;
    out.push({
      dimension: "renderStability", points: 7,
      reason: `${vanishing.length} ta komponent kichik o'lchamda ko'rinmay ketadi (${smallest}px).`,
      fix: "Juda ingichka detallarni olib tashlang yoki yo'g'onlashtiring.",
    });
  }

  const heavy = components.length > 40;
  if (heavy) {
    earned -= 5;
    out.push({
      dimension: "renderStability", points: 5,
      reason: `${components.length} ta komponent — telefonda va PPTX'da og'irlik qiladi.`,
    });
  }

  if (!element.transform.rotatable && element.geometry.originalRotation !== 0) {
    earned -= 3;
    out.push({
      dimension: "renderStability", points: 3,
      reason: "Element burilgan holda saqlangan, lekin aylantirilmaydi deb belgilangan.",
    });
  }

  return Math.max(0, earned);
}

/** Semantics: is this named for what it is, and does it say where it belongs? */
function checkSemantics(element: JElement, out: HealthDeduction[]): number {
  let earned: number = WEIGHTS.semantics;

  if (element.usage.slideRoles.length === 0) {
    earned -= 6;
    out.push({
      dimension: "semantics", points: 6,
      reason: "Slayd rollari ko'rsatilmagan.",
      fix: "Rejalashtiruvchi bu elementni hech qaysi slaydga tanlamaydi.",
    });
  }

  if (element.objectClass === "other") {
    earned -= 3;
    out.push({ dimension: "semantics", points: 3, reason: "Obyekt sinfi aniqlanmagan." });
  }

  // A name describing the paint stops being true the moment the family is
  // recoloured, and it makes searching depend on knowing the colour.
  if (/^(qora|oq|yashil|ko'k|qizil|black|white|green|blue|red|dark|light)\b/i.test(element.canonicalName)) {
    earned -= 4;
    out.push({
      dimension: "semantics", points: 4,
      reason: `"${element.canonicalName}" ko'rinishga qarab nomlangan.`,
      fix: "Nom obyekt nima ekanini aytsin — rangi oilaning ishi.",
    });
  }

  if (element.usage.bestFor.length === 0) {
    earned -= 2;
    out.push({ dimension: "semantics", points: 2, reason: "Qaysi holatlarda mos kelishi yozilmagan." });
  }

  return Math.max(0, earned);
}

/** Mobile: is it usable on a phone, at a phone's size and with a finger? */
function checkMobile(element: JElement, out: HealthDeduction[]): number {
  let earned: number = WEIGHTS.mobile;

  if (element.usage.recommendedMaxSlideCoverage > 0.75) {
    earned -= 4;
    out.push({
      dimension: "mobile", points: 4,
      reason: "Tavsiya etilgan maksimal qamrov juda katta — slaydda matnga joy qolmaydi.",
    });
  }

  if (element.geometry.components.length > 24) {
    earned -= 4;
    out.push({
      dimension: "mobile", points: 4,
      reason: `${element.geometry.components.length} ta shakl — telefon muharririda sekinlashadi.`,
    });
  }

  if (!element.transform.scalable) {
    earned -= 2;
    out.push({ dimension: "mobile", points: 2, reason: "O'lchami o'zgartirilmaydi — telefonda joylashtirish qiyin." });
  }

  return Math.max(0, earned);
}

export function elementHealth(element: JElement, family: JElementFamily): HealthReport {
  const deductions: HealthDeduction[] = [];

  const dimensions = {
    geometry: { earned: checkGeometry(element, deductions), possible: WEIGHTS.geometry },
    search: { earned: checkSearch(element, deductions), possible: WEIGHTS.search },
    recolorability: { earned: checkRecolorability(element, family, deductions), possible: WEIGHTS.recolorability },
    renderStability: { earned: checkRenderStability(element, deductions), possible: WEIGHTS.renderStability },
    semantics: { earned: checkSemantics(element, deductions), possible: WEIGHTS.semantics },
    mobile: { earned: checkMobile(element, deductions), possible: WEIGHTS.mobile },
  };

  const score = Object.values(dimensions).reduce((sum, entry) => sum + entry.earned, 0);
  return { score: Math.round(score), dimensions, deductions };
}

/** A family scores as its weakest members, not its average. */
export function familyHealth(family: JElementFamily): HealthReport & { perElement: Record<string, number> } {
  const perElement: Record<string, number> = {};
  const deductions: HealthDeduction[] = [];
  const totals: Record<string, { earned: number; possible: number }> = {};

  for (const element of family.elements) {
    const report = elementHealth(element, family);
    perElement[element.canonicalName] = report.score;

    for (const [name, value] of Object.entries(report.dimensions)) {
      const running = totals[name] ?? { earned: 0, possible: 0 };
      totals[name] = { earned: running.earned + value.earned, possible: running.possible + value.possible };
    }
    for (const deduction of report.deductions) {
      deductions.push({ ...deduction, reason: `${element.canonicalName}: ${deduction.reason}` });
    }
  }

  const count = Math.max(1, family.elements.length);
  const dimensions = Object.fromEntries(
    Object.entries(totals).map(([name, value]) => [name, { earned: value.earned / count, possible: value.possible / count }]),
  );
  const score = Object.values(dimensions).reduce((sum, entry) => sum + entry.earned, 0);

  return { score: Math.round(score), dimensions, deductions, perElement };
}

/**
 * The previews every element is checked at.
 *
 * Two grounds, three sizes and four angles, because these are the conditions
 * under which detail disappears and a colour binding turns out to be wrong —
 * and none of them show up looking at one large preview on white.
 */
export function previewMatrix(): { size: number; rotation: number; background: "light" | "dark" }[] {
  const matrix: { size: number; rotation: number; background: "light" | "dark" }[] = [];
  for (const background of ["light", "dark"] as const) {
    for (const size of MIN_PREVIEW_SIZES) {
      for (const rotation of PREVIEW_ROTATIONS) matrix.push({ size, rotation, background });
    }
  }
  return matrix;
}
