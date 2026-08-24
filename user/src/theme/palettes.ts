/**
 * The same palette, twice.
 *
 * Every colour the app draws has one name and two values, so a screen asks for
 * `surface` and gets the right thing in either mode without knowing which mode
 * it is in. Adding a colour means adding it here, in both — a key that exists
 * in one and not the other is a screen that goes blank at night.
 *
 * The dark side is not the light side inverted. Inverting a palette gives you
 * pure black under pure white text, which on an OLED phone at midnight is a
 * torch: contrast so high the letters buzz. So the dark ground is a very dark
 * violet rather than black, the surfaces above it are lighter rather than
 * darker, and the type sits a little below full white. The brand violet is
 * lifted, because a saturated colour that reads as rich on white reads as mud
 * on near-black.
 */

export type Palette = {
  ink: string;
  inkMuted: string;
  inkSoft: string;

  canvas: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;

  primary: string;
  primaryPressed: string;
  primaryDeep: string;
  primaryBright: string;
  primarySoft: string;
  onPrimary: string;
  onPrimaryMuted: string;


  accent: string;
  accentSoft: string;

  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  success: string;
  successSoft: string;
  successBorder: string;
  warning: string;
  warningSoft: string;
  warningBorder: string;

  /**
   * Glass. The bottom nav is a translucent bar over whatever is scrolling
   * beneath it, so it cannot be a flat surface colour — it is three stops and
   * a hairline rim, and it needs a second, opaque set for the platforms where
   * the blur is not available.
   */
  glassSheen: readonly [string, string, string];
  glassSheenOpaque: readonly [string, string, string];
  glassRim: string;

  /**
   * The soft surface, and why it is not `surface`.
   *
   * The tool cards on Loyihalar carry their own artwork, and artwork needs a
   * quiet ground to read against. `surface` is pure white on a white canvas —
   * a card that has to be found by its border alone. This is a shade cooler
   * and a shade darker, so a card is a card without a line around it doing all
   * the work, and its ink leans navy rather than violet for the same reason:
   * nothing on the card should compete with what is drawn on it.
   */
  softCard: string;
  softCardBorder: string;
  softInk: string;
  softInkMuted: string;

  /** The wash behind the sign-in screen, which the marks sit on. */
  authWash: readonly [string, string, string];

  shadow: string;
};

export const light: Palette = {
  ink: "#150E24",
  inkMuted: "#5B5270",
  inkSoft: "#9189A6",

  canvas: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F6F3FD",
  border: "#EBE6F5",
  borderStrong: "#D8CEEC",

  primary: "#6C34C9",
  primaryPressed: "#5726A4",
  primaryDeep: "#3A1573",
  primaryBright: "#8B54E8",
  primarySoft: "#F0E9FC",
  onPrimary: "#FFFFFF",
  onPrimaryMuted: "#D6C4F6",

  accent: "#8B5CF6",
  accentSoft: "#C7B2F3",

  danger: "#C43552",
  dangerSoft: "#FCEBEF",
  dangerBorder: "#F3D4DB",
  success: "#0F9D74",
  successSoft: "#E4F6F0",
  successBorder: "#BEE7DA",
  warning: "#B4690E",
  warningSoft: "#FDF4E5",
  warningBorder: "#F0DFC0",

  glassSheen: ["rgba(255,255,255,0.86)", "rgba(255,255,255,0.62)", "rgba(240,233,252,0.66)"],
  glassSheenOpaque: ["rgba(255,255,255,0.99)", "rgba(252,251,254,0.97)", "rgba(240,233,252,0.96)"],
  glassRim: "rgba(216,206,236,0.9)",

  softCard: "#F6F7FB",
  softCardBorder: "#E8E9F2",
  softInk: "#20263B",
  softInkMuted: "#6F7487",

  authWash: ["#F4EDFE", "#FDF1F8", "#FFFFFF"],

  shadow: "#2A0F55",
};

export const dark: Palette = {
  // Just under white: full white on near-black vibrates at low brightness.
  ink: "#F2EEFA",
  inkMuted: "#B0A7C4",
  inkSoft: "#7E7593",

  // A very dark violet rather than black, so the brand survives the dark and
  // an OLED panel does not turn every card edge into a hard cut.
  canvas: "#100A1B",
  surface: "#1A1327",
  surfaceMuted: "#241A35",
  border: "#2E2342",
  borderStrong: "#42355C",

  // Lifted: #6C34C9 is rich on white and muddy on near-black.
  primary: "#9A6BF0",
  primaryPressed: "#8355DC",
  // "Deep" means "reads as the strong end of the brand", which at night is the
  // light end — the name describes the role, not the luminance.
  primaryDeep: "#C7ADFA",
  primaryBright: "#B590F7",
  primarySoft: "#2A1D45",
  onPrimary: "#120B1F",
  onPrimaryMuted: "#4A3670",

  accent: "#A78BFA",
  accentSoft: "#3A2B5E",

  danger: "#F4788F",
  dangerSoft: "#3A1B24",
  dangerBorder: "#5A2B38",
  success: "#3DD6A6",
  successSoft: "#12332A",
  successBorder: "#1E5C48",
  warning: "#E0A44A",
  warningSoft: "#33260F",
  warningBorder: "#5E4820",

  // Dark glass is the same material seen from the other side: the bar is a
  // lifted plate over the canvas, so it lightens rather than whitens.
  glassSheen: ["rgba(46,35,66,0.86)", "rgba(36,26,53,0.72)", "rgba(26,19,39,0.72)"],
  glassSheenOpaque: ["rgba(42,32,60,0.99)", "rgba(33,24,49,0.98)", "rgba(26,19,39,0.98)"],
  glassRim: "rgba(90,74,120,0.9)",

  softCard: "#1C1D24",
  softCardBorder: "#2C2E38",
  softInk: "#F4F4F7",
  softInkMuted: "#A7AAB6",

  authWash: ["#1B1230", "#170F28", "#100A1B"],

  shadow: "#000000",
};
