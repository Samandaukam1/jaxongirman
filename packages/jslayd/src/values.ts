import type { Border, ColorValue, Corners, Gradient, GradientStop, Shadow } from "./document.ts";
import { DiagnosticBag, nearestName } from "./diagnostics.ts";
import { findNode, type ParseNode } from "./parser.ts";
import {
  BINDING_PATTERN,
  BINDINGS,
  BORDER_STYLES,
  COLOR_ROLES,
  GRADIENT_TYPES,
  HEX_COLOR_PATTERN,
  LIMITS,
  type Binding,
  type ColorRole,
} from "./spec.ts";

/**
 * Scalar readers.
 *
 * Every one of them takes the diagnostic bag and a fallback: a bad value is
 * reported once and the compile carries on, so an author sees every mistake in
 * the file at once instead of one per attempt. `undefined` back from a reader
 * means "not present", never "present but wrong" — a wrong value has already
 * been reported and returns the fallback.
 */

export function readString(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag, max: number = LIMITS.textLength): string | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  if (!node.value) {
    bag.error("empty_value", `\`${key}\` qiymati bo'sh.`, node.line);
    return undefined;
  }
  if (node.value.length > max) {
    bag.error("value_too_long", `\`${key}\` juda uzun (${node.value.length} belgi).`, node.line, `Chegara ${max} belgi.`);
    return node.value.slice(0, max);
  }
  return node.value;
}

export function readNumber(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag, range?: { min: number; max: number }): number | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  return coerceNumber(node.value, key, node.line, bag, range);
}

/**
 * Numbers accept a trailing unit so `rotation: -6deg` and `width: 690px` read
 * naturally (§13). The unit is decoration: JSLAYD has exactly one length unit,
 * the canvas unit, and one angle unit, the degree.
 */
export function coerceNumber(raw: string, key: string, line: number, bag: DiagnosticBag, range?: { min: number; max: number }): number | undefined {
  const cleaned = raw.trim().replace(/(deg|px|pt|%)$/i, "").trim();
  const value = Number(cleaned);
  if (!cleaned || !Number.isFinite(value)) {
    bag.error("not_a_number", `\`${key}\` son emas: "${raw}".`, line);
    return undefined;
  }
  if (range && (value < range.min || value > range.max)) {
    bag.error("out_of_range", `\`${key}\` chegaradan tashqarida: ${value}.`, line, `Ruxsat etilgan oraliq ${range.min} … ${range.max}.`);
    return Math.min(Math.max(value, range.min), range.max);
  }
  return value;
}

export function readInteger(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag, range?: { min: number; max: number }): number | undefined {
  const value = readNumber(nodes, key, bag, range);
  if (value === undefined) return undefined;
  return Math.round(value);
}

export function readBoolean(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag): boolean | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  const value = node.value.toLowerCase();
  if (["true", "ha", "yes", "1"].includes(value)) return true;
  if (["false", "yo'q", "yoq", "no", "0"].includes(value)) return false;
  bag.error("not_a_boolean", `\`${key}\` ha/yo'q qiymat emas: "${node.value}".`, node.line, "true yoki false yozing.");
  return undefined;
}

export function readEnum<T extends string>(nodes: readonly ParseNode[], key: string, allowed: readonly T[], bag: DiagnosticBag): T | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  return coerceEnum(node.value, key, allowed, node.line, bag);
}

export function coerceEnum<T extends string>(raw: string, key: string, allowed: readonly T[], line: number, bag: DiagnosticBag): T | undefined {
  const value = raw.trim();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  const suggestion = nearestName(value, allowed);
  bag.error(
    "unknown_value",
    `\`${key}\` uchun noma'lum qiymat: "${value}".`,
    line,
    suggestion ? `Balki "${suggestion}"? Ruxsat etilganlar: ${allowed.join(", ")}.` : `Ruxsat etilganlar: ${allowed.join(", ")}.`,
  );
  return undefined;
}

/** Comma- or space-separated list, empty entries dropped. */
export function readList(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag): string[] | undefined {
  const value = readString(nodes, key, bag);
  if (value === undefined) return undefined;
  return splitList(value);
}

export function splitList(value: string): string[] {
  return value.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
}

/* ----------------------------------------------------------------- colours */

/**
 * A colour is a role name or a literal. Role names are strongly preferred and
 * the analyzer says so, because a literal is the one thing a colour family
 * cannot recolour (§16, §29).
 */
export function coerceColor(raw: string, key: string, line: number, bag: DiagnosticBag): ColorValue | undefined {
  const value = raw.trim();
  if (!value) {
    bag.error("empty_value", `\`${key}\` rangi bo'sh.`, line);
    return undefined;
  }
  if ((COLOR_ROLES as readonly string[]).includes(value)) return { role: value as ColorRole };
  const hex = normalizeHex(value);
  if (hex) return { hex };
  const suggestion = nearestName(value, COLOR_ROLES);
  bag.error(
    "unknown_color",
    `\`${key}\` rangini o'qib bo'lmadi: "${value}".`,
    line,
    suggestion
      ? `Balki "${suggestion}"? Rang roli yoki #RRGGBB ko'rinishidagi qiymat kutilgan.`
      : `Rang roli (${COLOR_ROLES.join(", ")}) yoki #RRGGBB ko'rinishidagi qiymat kutilgan.`,
  );
  return undefined;
}

export function readColor(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag): ColorValue | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  return coerceColor(node.value, key, node.line, bag);
}

/**
 * Canonical `#RRGGBB` or `#RRGGBBAA`, upper case (§16).
 *
 * Accepts the shorthands and `rgb()/rgba()` on the way in so an author pasting
 * from a design tool is not stopped by notation, but stores exactly one
 * spelling — two designs that name the same colour must compile to the same
 * bytes, or the content hash stops being a version identity.
 */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (HEX_COLOR_PATTERN.test(trimmed)) {
    const body = trimmed.slice(1);
    const expanded = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
    return `#${expanded.toUpperCase()}`;
  }
  const functional = /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/i.exec(trimmed);
  if (!functional) return null;
  const channel = (part: string) => Math.min(255, Math.max(0, Math.round(Number(part)))).toString(16).padStart(2, "0").toUpperCase();
  const alphaRaw = functional[4];
  const alpha = alphaRaw === undefined
    ? ""
    : channel(String((alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw)) * 255));
  const parts = [functional[1]!, functional[2]!, functional[3]!].map(channel);
  if (parts.some((part) => part === "NAN")) return null;
  return `#${parts.join("")}${alpha === "FF" ? "" : alpha}`;
}

/* --------------------------------------------------------------- gradients */

/**
 * Gradients carry as many stops as the author writes (§17). Two is the minimum
 * that means anything; the rest is the design's business, up to the untrusted
 * input ceiling.
 *
 *   gradient:
 *     type: linear
 *     angle: 135
 *     stops:
 *       0: #FF7100
 *       50: #FFB000
 *       100: #FFE86A
 *
 * The shorthand `gradient: linear 135 #FF7100 #FFB000 #FFE86A` distributes the
 * stops evenly and is what most designs actually need.
 */
export function readGradient(nodes: readonly ParseNode[], key: string, bag: DiagnosticBag): Gradient | undefined {
  const node = findNode(nodes, key);
  if (!node) return undefined;
  return node.children.length ? readGradientBlock(node, key, bag) : readGradientShorthand(node, key, bag);
}

function readGradientShorthand(node: ParseNode, key: string, bag: DiagnosticBag): Gradient | undefined {
  const parts = splitList(node.value);
  if (parts.length === 0) {
    bag.error("empty_value", `\`${key}\` gradienti bo'sh.`, node.line);
    return undefined;
  }
  let index = 0;
  let type: Gradient["type"] = "linear";
  if ((GRADIENT_TYPES as readonly string[]).includes(parts[0]!)) {
    type = parts[0] as Gradient["type"];
    index = 1;
  }
  let angle = 135;
  const maybeAngle = parts[index];
  if (maybeAngle && /^-?\d+(?:\.\d+)?(?:deg)?$/.test(maybeAngle)) {
    angle = Number(maybeAngle.replace("deg", ""));
    index += 1;
  }
  const colors: ColorValue[] = [];
  for (const part of parts.slice(index)) {
    const color = coerceColor(part, key, node.line, bag);
    if (color) colors.push(color);
  }
  return finishGradient(type, angle, evenStops(colors), key, node.line, bag);
}

function readGradientBlock(node: ParseNode, key: string, bag: DiagnosticBag): Gradient | undefined {
  const known = new Set(["type", "angle", "stops"]);
  for (const child of node.children) {
    if (!known.has(child.key)) {
      bag.error("unknown_property", `Gradientda noma'lum xossa: \`${child.key}\`.`, child.line, `Ruxsat etilganlar: ${[...known].join(", ")}.`);
    }
  }
  const type = coerceEnum(findNode(node.children, "type")?.value ?? "linear", `${key}.type`, GRADIENT_TYPES, node.line, bag) ?? "linear";
  const angleNode = findNode(node.children, "angle");
  const angle = angleNode ? coerceNumber(angleNode.value, `${key}.angle`, angleNode.line, bag, { min: -360, max: 360 }) ?? 135 : 135;

  const stopsNode = findNode(node.children, "stops");
  if (!stopsNode) {
    bag.error("missing_property", `\`${key}\` gradientida \`stops\` yo'q.`, node.line);
    return undefined;
  }
  const stops: GradientStop[] = [];
  for (const entry of stopsNode.children) {
    const offset = coerceNumber(entry.key, `${key}.stops`, entry.line, bag, { min: 0, max: 100 });
    const color = coerceColor(entry.value, `${key}.stops.${entry.key}`, entry.line, bag);
    if (offset === undefined || !color) continue;
    stops.push({ offset, color });
  }
  return finishGradient(type, angle, stops, key, node.line, bag);
}

/**
 * Spreads colours across 0–100. A single colour deliberately produces a single
 * stop so `finishGradient` rejects it: a one-colour gradient is a flat fill the
 * author wrote in the wrong place, and duplicating the stop would hide that.
 */
function evenStops(colors: readonly ColorValue[]): GradientStop[] {
  if (colors.length <= 1) return colors.map((color) => ({ offset: 0, color }));
  return colors.map((color, index) => ({ offset: Math.round((index / (colors.length - 1)) * 100), color }));
}

function finishGradient(type: Gradient["type"], angle: number, stops: GradientStop[], key: string, line: number, bag: DiagnosticBag): Gradient | undefined {
  if (stops.length < 2) {
    bag.error("gradient_too_short", `\`${key}\` gradientida kamida 2 ta stop bo'lishi kerak.`, line);
    return undefined;
  }
  if (stops.length > LIMITS.gradientStops) {
    bag.error("gradient_too_long", `\`${key}\` gradientida ${stops.length} ta stop bor.`, line, `Chegara ${LIMITS.gradientStops} ta.`);
    stops = stops.slice(0, LIMITS.gradientStops);
  }
  const sorted = [...stops].sort((first, second) => first.offset - second.offset);
  return { type, angle: normalizeAngle(angle), stops: sorted };
}

/** Degrees folded into 0–359 so two spellings of one angle hash identically. */
export function normalizeAngle(value: number): number {
  const folded = value % 360;
  return Math.round((folded < 0 ? folded + 360 : folded) * 100) / 100;
}

/* ----------------------------------------------------------------- shadows */

/**
 *   shadow: 0 18 40 0 0.24 contrast        # x y blur spread opacity color
 *   shadow:
 *     offsetX: 0
 *     offsetY: 18
 *     …
 *
 * `shadows:` takes the same forms and repeats, which is how a design carries a
 * multiple shadow (§12).
 */
export function readShadows(nodes: readonly ParseNode[], bag: DiagnosticBag): Shadow[] {
  const shadows: Shadow[] = [];
  for (const node of nodes) {
    if (node.key !== "shadow" && node.key !== "shadows") continue;
    if (node.children.length) {
      const parsed = readShadowBlock(node, bag);
      if (parsed) shadows.push(parsed);
      continue;
    }
    // `shadows: none` is how a design opts out of an inherited family shadow.
    if (node.value.toLowerCase() === "none") continue;
    const parsed = readShadowShorthand(node, bag);
    if (parsed) shadows.push(parsed);
  }
  if (shadows.length > LIMITS.shadows) {
    bag.error("too_many_shadows", `${shadows.length} ta soya e'lon qilingan.`, nodes[0]?.line ?? 0, `Chegara ${LIMITS.shadows} ta.`);
    return shadows.slice(0, LIMITS.shadows);
  }
  return shadows;
}

function readShadowShorthand(node: ParseNode, bag: DiagnosticBag): Shadow | undefined {
  const parts = splitList(node.value);
  if (parts.length < 3) {
    bag.error(
      "bad_shadow",
      `\`${node.key}\` soyasini o'qib bo'lmadi: "${node.value}".`,
      node.line,
      "Format: `shadow: offsetX offsetY blur [spread] [opacity] [color]`.",
    );
    return undefined;
  }
  const numberAt = (index: number, fallback: number) =>
    parts[index] === undefined ? fallback : coerceNumber(parts[index]!, node.key, node.line, bag) ?? fallback;
  const colorPart = parts.find((part) => part.startsWith("#") || (COLOR_ROLES as readonly string[]).includes(part));
  return {
    offsetX: numberAt(0, 0),
    offsetY: numberAt(1, 0),
    blur: Math.max(0, numberAt(2, 0)),
    spread: parts.length > 3 && parts[3] !== colorPart ? numberAt(3, 0) : 0,
    opacity: clampUnit(parts.length > 4 && parts[4] !== colorPart ? numberAt(4, 0.2) : 0.2),
    color: (colorPart ? coerceColor(colorPart, node.key, node.line, bag) : undefined) ?? { role: "contrast" },
  };
}

function readShadowBlock(node: ParseNode, bag: DiagnosticBag): Shadow | undefined {
  const known = new Set(["offsetX", "offsetY", "blur", "spread", "opacity", "color"]);
  for (const child of node.children) {
    if (!known.has(child.key)) {
      bag.error("unknown_property", `Soyada noma'lum xossa: \`${child.key}\`.`, child.line, `Ruxsat etilganlar: ${[...known].join(", ")}.`);
    }
  }
  const value = (key: string, fallback: number) => readNumber(node.children, key, bag) ?? fallback;
  return {
    offsetX: value("offsetX", 0),
    offsetY: value("offsetY", 0),
    blur: Math.max(0, value("blur", 0)),
    spread: value("spread", 0),
    opacity: clampUnit(value("opacity", 0.2)),
    color: readColor(node.children, "color", bag) ?? { role: "contrast" },
  };
}

/* ------------------------------------------------------- corners & borders */

/**
 * `borderRadius: 32` or per-corner values, in either the four-number shorthand
 * (`borderRadius: 32 32 0 0`, clockwise from top-left) or the named properties
 * of §14.
 */
export function readCorners(nodes: readonly ParseNode[], bag: DiagnosticBag): Corners | undefined {
  const named = {
    topLeft: readNumber(nodes, "topLeftRadius", bag, { min: 0, max: 2000 }),
    topRight: readNumber(nodes, "topRightRadius", bag, { min: 0, max: 2000 }),
    bottomRight: readNumber(nodes, "bottomRightRadius", bag, { min: 0, max: 2000 }),
    bottomLeft: readNumber(nodes, "bottomLeftRadius", bag, { min: 0, max: 2000 }),
  };
  const radiusNode = findNode(nodes, "borderRadius");
  let uniform: Corners | undefined;
  if (radiusNode) {
    const parts = splitList(radiusNode.value);
    const numbers = parts.map((part) => coerceNumber(part, "borderRadius", radiusNode.line, bag, { min: 0, max: 2000 }) ?? 0);
    if (numbers.length === 1) {
      const all = numbers[0]!;
      uniform = { topLeft: all, topRight: all, bottomRight: all, bottomLeft: all };
    } else if (numbers.length === 4) {
      uniform = { topLeft: numbers[0]!, topRight: numbers[1]!, bottomRight: numbers[2]!, bottomLeft: numbers[3]! };
    } else {
      bag.error("bad_radius", `\`borderRadius\` 1 yoki 4 ta son kutadi, ${numbers.length} ta berilgan.`, radiusNode.line);
    }
  }
  if (!uniform && Object.values(named).every((value) => value === undefined)) return undefined;
  const base = uniform ?? { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  return {
    topLeft: named.topLeft ?? base.topLeft,
    topRight: named.topRight ?? base.topRight,
    bottomRight: named.bottomRight ?? base.bottomRight,
    bottomLeft: named.bottomLeft ?? base.bottomLeft,
  };
}

export function readBorder(nodes: readonly ParseNode[], bag: DiagnosticBag): Border | undefined {
  const width = readNumber(nodes, "borderWidth", bag, { min: 0, max: 200 });
  const color = readColor(nodes, "borderColor", bag);
  const style = readEnum(nodes, "borderStyle", BORDER_STYLES, bag);
  const opacity = readNumber(nodes, "borderOpacity", bag, { min: 0, max: 1 });
  if (width === undefined && !color && !style && opacity === undefined) return undefined;
  if (width === undefined || width === 0) {
    // A colour with no width draws nothing. Saying so beats a mystery.
    if (color || style) {
      bag.warn("border_without_width", "Chegara rangi berilgan, lekin `borderWidth` yo'q.", findNode(nodes, "borderColor")?.line ?? 0, "Chegara chizilmaydi.");
    }
    return undefined;
  }
  return { width, color: color ?? { role: "border" }, style: style ?? "solid", opacity: opacity ?? 1 };
}

/* ---------------------------------------------------------------- bindings */

/** `{{title}}` → `title`, and nothing else is a binding (§38). */
export function coerceBinding(raw: string, key: string, line: number, bag: DiagnosticBag): Binding | undefined {
  const match = BINDING_PATTERN.exec(raw.trim());
  if (!match) {
    bag.error(
      "bad_binding",
      `\`${key}\` bog'lanishi noto'g'ri: "${raw}".`,
      line,
      "Format: `{{title}}`. Faqat ro'yxatdagi nomlar ishlaydi.",
    );
    return undefined;
  }
  const name = match[1]!;
  if (!(BINDINGS as readonly string[]).includes(name)) {
    const suggestion = nearestName(name, BINDINGS);
    bag.error(
      "unknown_binding",
      `Noma'lum bog'lanish: \`{{${name}}}\`.`,
      line,
      suggestion ? `Balki \`{{${suggestion}}}\`?` : `Ruxsat etilganlar: ${BINDINGS.join(", ")}.`,
    );
    return undefined;
  }
  return name as Binding;
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Reports every key in `nodes` that is not in `known` (§50).
 *
 * This is the single mechanism that makes JSLAYD strict. It runs on every block
 * the compiler reads, so a property that no reader consumed cannot pass through
 * unnoticed — which is exactly the failure mode that produces a design that
 * looks nothing like what its author wrote.
 */
export function rejectUnknownKeys(nodes: readonly ParseNode[], known: readonly string[], what: string, bag: DiagnosticBag): void {
  const allowed = new Set(known);
  for (const node of nodes) {
    if (allowed.has(node.key)) continue;
    const suggestion = nearestName(node.key, known);
    bag.error(
      "unknown_property",
      `${what} uchun noma'lum buyruq: \`${node.key}\`.`,
      node.line,
      suggestion ? `Balki \`${suggestion}\`?` : `Ruxsat etilgan buyruqlar: ${known.join(", ")}.`,
    );
  }
}

/** Duplicated keys are ambiguous; the compiler takes the first and says so. */
export function rejectDuplicateKeys(nodes: readonly ParseNode[], repeatable: readonly string[], bag: DiagnosticBag): void {
  const seen = new Set<string>();
  const allowRepeat = new Set(repeatable);
  for (const node of nodes) {
    if (allowRepeat.has(node.key)) continue;
    if (seen.has(node.key)) {
      bag.error("duplicate_property", `\`${node.key}\` ikki marta e'lon qilingan.`, node.line, "Birinchisi ishlatiladi.");
      continue;
    }
    seen.add(node.key);
  }
}
