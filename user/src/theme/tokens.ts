import { Platform } from "react-native";

/**
 * Brand palette sampled from the Jaxongirman mascot suit: a saturated royal
 * violet with metallic highlights, set on a pure white canvas.
 */

/**
 * Metallic brand gradients — the sheen that makes the suit read as premium.
 *
 * These do not follow the theme. They are the brand, and the brand is deep
 * violet on a phone held in the dark just as much as in daylight. Anything
 * drawn on one takes `brandInk` below rather than a palette entry.
 */
export const gradients = {
  primary: ["#8B54E8", "#6C34C9"] as const,
  hero: ["#7B41DC", "#3F1780"] as const,
  success: ["#16A77B", "#0B7F5C"] as const,
  danger: ["#D9455F", "#9E2036"] as const,
  /**
   * O‘yingoh reads louder than the rest of the app on purpose: it is the one
   * place where a phone competes with a lit projector for attention. Each
   * action gets its own hue so the row is legible at a glance and never
   * depends on colour alone — every button carries an icon and a label too.
   *
   * The light stops are darker than the hue wants to be. White has to clear
   * 3:1 across the whole sweep, and amber in particular does not get there at
   * full brightness — a label nobody can read is not a louder button.
   */
  create: ["#9A5CF5", "#5B21B6"] as const,
  join: ["#11A2B8", "#0A6E86"] as const,
  host: ["#CE8310", "#C2610C"] as const,

  /**
   * Loyihalar borrows O‘yingoh's shape and not its palette.
   *
   * The two screens are siblings — the same hero, the same tiles under it — so
   * repeating teal and amber here would make them look like one screen shown
   * twice. These are jewel tones a step away from the brand violet, one per
   * tool, so a person learns the tile by its colour before they read it. Every
   * stop clears 3:1 against white; the amber lesson above applies here too.
   */
  portrait: ["#D14D75", "#8E2247"] as const,
  objective: ["#5566DE", "#2B349B"] as const,
  academic: ["#12A276", "#07684A"] as const,
  importDeck: ["#DB6A3A", "#9B3714"] as const,
  present: ["#B04ACB", "#6E2385"] as const,
} as const;

/**
 * Ink for the brand gradients — and the reason it does not live in the palette.
 *
 * `primary` flips with the theme: dark violet on a white canvas, light violet
 * on a dark one, and `onPrimary` flips with it, so a flat primary button stays
 * readable either way. The gradients above do not flip. They are the suit, and
 * the suit is deep violet in both themes. Anything drawn on one therefore needs
 * the ink belonging to *that* surface, which is white and stays white — a
 * palette entry would only invite it to be themed by mistake.
 */
export const brandInk = {
  /** Headings, figures and glyphs laid straight on a gradient. */
  strong: "#FFFFFF",
  /** Labels and secondary lines on the same surface. */
  muted: "rgba(255,255,255,0.76)",
  /** A solid plate laid on the gradient — a filled button inside a hero card. */
  plate: "#FFFFFF",
  /** Ink on that plate. Deep violet, because the plate is always white. */
  onPlate: "#3A1573",
} as const;

export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** One stroke weight and one size scale, so every icon reads as a set. */
export const icon = { stroke: 1.85, strokeBold: 2.4, xs: 14, sm: 16, md: 20, lg: 24, xl: 28 } as const;

export const typography = {
  display: { fontFamily: "Manrope_700Bold", fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  title: { fontFamily: "Manrope_700Bold", fontSize: 24, lineHeight: 31, letterSpacing: -0.3 },
  heading: { fontFamily: "Manrope_700Bold", fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: "Manrope_600SemiBold", fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 17 },
} as const;

/**
 * Elevation. A shadow is cast ink, not a palette entry: it is the same colour
 * in both themes, and it simply stops being visible on a dark canvas — which
 * is right, because dark interfaces convey height by lightening the surface
 * (`surface` sits above `canvas`) rather than by darkening what is under it.
 * The lifted one is a violet glow under a violet button and reads in both.
 */
const CAST = "#2A0F55";
const GLOW = "#6C34C9";

/** Resting elevation for cards on white. */
export const shadow = Platform.select({
  ios: { shadowColor: CAST, shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 2 },
  default: {},
});

/** Raised elevation for primary actions — tinted violet, never grey. */
export const shadowLifted = Platform.select({
  ios: { shadowColor: GLOW, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 6 },
  default: {},
});
