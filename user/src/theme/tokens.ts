import { Platform } from "react-native";

/**
 * Brand palette sampled from the Jaxongirman mascot suit: a saturated royal
 * violet with metallic highlights, set on a pure white canvas.
 */
export const colors = {
  // Text
  ink: "#150E24",
  inkMuted: "#5B5270",
  inkSoft: "#9189A6",

  // Surfaces — the app is fully white
  canvas: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F6F3FD",
  border: "#EBE6F5",
  borderStrong: "#D8CEEC",

  // Brand
  primary: "#6C34C9",
  primaryPressed: "#5726A4",
  primaryDeep: "#3A1573",
  primaryBright: "#8B54E8",
  primarySoft: "#F0E9FC",
  onPrimary: "#FFFFFF",
  onPrimaryMuted: "#D6C4F6",

  accent: "#8B5CF6",
  accentSoft: "#C7B2F3",

  // Status
  danger: "#C43552",
  dangerSoft: "#FCEBEF",
  success: "#0F9D74",
  successSoft: "#E4F6F0",
  warning: "#B4690E",

  shadow: "#2A0F55",
} as const;

/** Metallic brand gradients — the sheen that makes the suit read as premium. */
export const gradients = {
  primary: ["#8B54E8", "#6C34C9"] as const,
  hero: ["#7B41DC", "#3F1780"] as const,
  deep: ["#4B1C96", "#22093F"] as const,
  soft: ["#F3ECFE", "#E3D6FA"] as const,
  success: ["#17B283", "#0B7F5C"] as const,
  danger: ["#D9455F", "#9E2036"] as const,
  /**
   * O‘yingoh reads louder than the rest of the app on purpose: it is the one
   * place where a phone competes with a lit projector for attention. Each
   * action gets its own hue so the row is legible at a glance and never
   * depends on colour alone — every button carries an icon and a label too.
   */
  create: ["#9A5CF5", "#5B21B6"] as const,
  join: ["#12B0C8", "#0A6E86"] as const,
  host: ["#F0A93C", "#C2610C"] as const,
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

/** Resting elevation for cards on white. */
export const shadow = Platform.select({
  ios: { shadowColor: colors.shadow, shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 2 },
  default: {},
});

/** Raised elevation for primary actions — tinted violet, never grey. */
export const shadowLifted = Platform.select({
  ios: { shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 6 },
  default: {},
});
