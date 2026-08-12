import * as Font from "expo-font";
import type { TextStyle, ViewStyle } from "react-native";

/**
 * Reading a rendered row's style bag on React Native.
 *
 * The DOM painter reads the same bag and has to reach the same picture, so the
 * decisions live here rather than inline in the canvas: which face to draw,
 * how a multi-stop gradient becomes gradient props, what a shadow object means
 * on a platform that only has one shadow. A JSLAYD slide that looked one way in
 * the admin preview and another on the phone would make the preview worthless
 * (§77, §85).
 */

type Bag = Record<string, unknown>;

export function bag(value: unknown): Bag {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Bag) : {};
}

export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map(bag) : [];
}

/**
 * The face to draw a row in.
 *
 * React Native takes a single family name rather than a stack, so the choice
 * has to be made here: the design's own face once it has loaded, and the
 * bundled fallback it nominated until then. `Font.isLoaded` is synchronous,
 * which is what lets this be a render-time decision rather than state.
 */
export function faceOf(style: Bag): string {
  const family = str(style.fontFamily);
  const fallback = str(style.fontFallback) || (str(style.fontWeight) === "700" ? "Manrope_700Bold" : "Manrope_400Regular");
  if (!family) return fallback;
  if (family === fallback) return family;
  try {
    return Font.isLoaded(family) ? family : fallback;
  } catch {
    // Older runtimes without the sync check: the fallback is always safe.
    return fallback;
  }
}

export type GradientPaint = {
  colors: string[];
  locations: number[];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

/**
 * A fill as gradient props, or null when the row is a flat colour.
 *
 * Reads JSLAYD's full stop list when there is one and the blueprints' two-stop
 * pair otherwise, so both vocabularies reach the same picture and a three-stop
 * gradient is not quietly flattened to its endpoints.
 */
export function gradientOf(style: Bag): GradientPaint | null {
  const stops = list(style.gradientStops);
  const angle = num(style.gradientAngle, 135);
  if (stops.length >= 2) {
    return {
      colors: stops.map((stop) => str(stop.color, "#000000")),
      locations: stops.map((stop) => Math.min(1, Math.max(0, num(stop.offset, 0) / 100))),
      ...gradientPoints(angle),
    };
  }
  const to = style.gradientTo;
  if (typeof to !== "string") return null;
  return { colors: [str(style.fill, "#FFFFFF"), to], locations: [0, 1], ...gradientPoints(angle) };
}

/** Degrees clockwise from twelve → the unit-square points the gradient takes. */
function gradientPoints(angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return { start: { x: 0.5 - x, y: 0.5 - y }, end: { x: 0.5 + x, y: 0.5 + y } };
}

/**
 * A shadow, as the platform can carry it.
 *
 * React Native draws one shadow per view, so a design that stacked three gets
 * the first — the one an author writes first is the one carrying the weight.
 * `shadow: true` is the blueprints' flag and keeps meaning the soft card
 * shadow those designs were drawn against.
 */
export function shadowOf(style: Bag): ViewStyle {
  const shadows = list(style.shadows);
  const first = shadows[0];
  if (first) {
    const radius = num(first.blur, 0);
    return {
      shadowColor: str(first.color, "#000000"),
      shadowOpacity: num(first.opacity, 0.2),
      shadowRadius: radius,
      shadowOffset: { width: num(first.offsetX, 0), height: num(first.offsetY, 0) },
      elevation: Math.round(Math.min(24, radius / 2)),
    };
  }
  if (style.shadow !== true) return {};
  return { shadowColor: "#1A1030", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 5 };
}

/**
 * Per-corner radii when the row carries them, one radius otherwise.
 *
 * Typed as radii alone rather than as a `ViewStyle`, because an `Image` accepts
 * a narrower style than a `View` does and this is applied to both.
 */
export type CornerRadii = {
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
};

export function cornersOf(style: Bag): CornerRadii {
  const corners = style.borderRadiusCorners;
  if (Array.isArray(corners) && corners.length === 4) {
    return {
      borderTopLeftRadius: num(corners[0], 0),
      borderTopRightRadius: num(corners[1], 0),
      borderBottomRightRadius: num(corners[2], 0),
      borderBottomLeftRadius: num(corners[3], 0),
    };
  }
  return { borderRadius: num(style.borderRadius, 0) };
}

export function borderOf(style: Bag): ViewStyle {
  const stroke = style.stroke;
  if (typeof stroke !== "string") return {};
  return {
    borderColor: stroke,
    borderWidth: num(style.strokeWidth, 1),
    borderStyle: (str(style.strokeStyle, "solid") as ViewStyle["borderStyle"]),
  };
}

/**
 * Text effects, as far as the platform goes.
 *
 * Stroke and gradient text have no React Native equivalent; the copy still
 * draws in its own colour, which is legible and honest, rather than being
 * approximated into something the design never asked for. The admin's export
 * warning is where an author is told about that (§11).
 */
export function textEffectOf(style: Bag, color: string): TextStyle {
  const shadows = list(style.shadows);
  const first = shadows[0];
  if (first) {
    return {
      textShadowColor: withAlpha(str(first.color, "#000000"), num(first.opacity, 0.4)),
      textShadowOffset: { width: num(first.offsetX, 0), height: num(first.offsetY, 0) },
      textShadowRadius: num(first.blur, 0),
    };
  }
  const effect = str(style.textEffect);
  if (effect === "shadow") return { textShadowColor: "rgba(0,0,0,.45)", textShadowOffset: { width: 2, height: 3 }, textShadowRadius: 3 };
  if (effect === "glow") return { textShadowColor: color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 };
  if (effect === "lift") return { textShadowColor: "rgba(0,0,0,.32)", textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 12 };
  return {};
}

export function withAlpha(hex: string, opacity: number): string {
  const body = hex.replace("#", "");
  const expanded = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
  const channel = (start: number) => Number.parseInt(expanded.slice(start, start + 2), 16) || 0;
  const base = expanded.length >= 8 ? channel(6) / 255 : 1;
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${Math.min(1, Math.max(0, opacity * base))})`;
}
