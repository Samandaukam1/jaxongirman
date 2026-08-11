import type { PaletteFamily } from "./design-types.ts";

/**
 * Seven curated colour families. Every family fills the same role set, so any
 * template renders correctly with any family — that is the whole contract.
 *
 * `contrast` is the deep block colour used for full-bleed accent slides;
 * `textOn*` roles must stay legible on their matching surface.
 */
export const paletteFamilies: readonly PaletteFamily[] = [
  {
    code: "limon_tun",
    name: "Limon va tun",
    sortOrder: 1,
    tokens: {
      background: "#F4F4F2",
      surface: "#FFFFFF",
      surfaceAlt: "#EBEBE7",
      contrast: "#14161A",
      primary: "#14161A",
      secondary: "#FFE9A3",
      accent: "#FFC93C",
      textPrimary: "#14161A",
      textSecondary: "#61636B",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#14161A",
      textOnContrast: "#FFFFFF",
      border: "#DFDFD9",
      chartSeries: ["#FFC93C", "#14161A", "#FFE9A3", "#8A8C93"],
    },
  },
  {
    code: "kobalt_qahrabo",
    name: "Kobalt va qahrabo",
    sortOrder: 2,
    tokens: {
      background: "#F5F7FF",
      surface: "#FFFFFF",
      surfaceAlt: "#E6ECFF",
      contrast: "#0B1B44",
      primary: "#1B4DE4",
      secondary: "#C9D8FF",
      accent: "#FFB020",
      textPrimary: "#0B1B44",
      textSecondary: "#5A648A",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#2B1A00",
      textOnContrast: "#FFFFFF",
      border: "#D8E0F7",
      chartSeries: ["#1B4DE4", "#FFB020", "#7FA0F5", "#0B1B44"],
    },
  },
  {
    code: "zumrad_moviy",
    name: "Zumrad va moviy",
    sortOrder: 3,
    tokens: {
      background: "#F2FAF7",
      surface: "#FFFFFF",
      surfaceAlt: "#DCF0E8",
      contrast: "#06251E",
      primary: "#0E9F6E",
      secondary: "#BCE5D6",
      accent: "#0B7285",
      textPrimary: "#06251E",
      textSecondary: "#4C6B62",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#FFFFFF",
      textOnContrast: "#FFFFFF",
      border: "#CFE7DE",
      chartSeries: ["#0E9F6E", "#0B7285", "#7FCBB0", "#06251E"],
    },
  },
  {
    code: "oq_kobalt",
    name: "Oq va kobalt",
    sortOrder: 4,
    tokens: {
      background: "#FFFFFF",
      surface: "#F6F8FC",
      surfaceAlt: "#E8EFFB",
      contrast: "#0F172A",
      primary: "#2563EB",
      secondary: "#DBE7FE",
      accent: "#93C5FD",
      textPrimary: "#0F172A",
      textSecondary: "#5B6880",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#0F172A",
      textOnContrast: "#FFFFFF",
      border: "#DDE5F2",
      chartSeries: ["#2563EB", "#93C5FD", "#0F172A", "#B9CDF0"],
    },
  },
  {
    code: "siyoh_lavanda",
    name: "Siyoh va lavanda",
    sortOrder: 5,
    tokens: {
      background: "#FBF9FF",
      surface: "#FFFFFF",
      surfaceAlt: "#F0E9FC",
      contrast: "#22093F",
      primary: "#6C34C9",
      secondary: "#DCCBF8",
      accent: "#C4B5FD",
      textPrimary: "#22093F",
      textSecondary: "#63577A",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#22093F",
      textOnContrast: "#FFFFFF",
      border: "#E6DDF6",
      chartSeries: ["#6C34C9", "#C4B5FD", "#22093F", "#A78BFA"],
    },
  },
  {
    code: "terrakota_qum",
    name: "Terrakota va qum",
    sortOrder: 6,
    tokens: {
      background: "#FBF6EE",
      surface: "#FFFFFF",
      surfaceAlt: "#F2E6D5",
      contrast: "#2B1A10",
      primary: "#C2410C",
      secondary: "#F0D9BE",
      accent: "#E7D3B8",
      textPrimary: "#2B1A10",
      textSecondary: "#6E5847",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#2B1A10",
      textOnContrast: "#FFFFFF",
      border: "#E8DAC6",
      chartSeries: ["#C2410C", "#E7D3B8", "#2B1A10", "#D98A5B"],
    },
  },
  {
    code: "toza_osmon",
    name: "Toza osmon",
    sortOrder: 7,
    tokens: {
      // The sky itself is the background, so `background` is the only family
      // value in the set that is a saturated colour rather than a near-white.
      background: "#4FC3E8",
      surface: "#FFFFFF",
      // The lighter wash the ground uses for its vertical lift, and the tone the
      // clouds are built from.
      surfaceAlt: "#7FD6F0",
      contrast: "#000000",
      primary: "#000000",
      // Warm paper, for the second sticky note. Never a random colour.
      secondary: "#F6EFD9",
      accent: "#E4F577",
      textPrimary: "#000000",
      // Body copy sits a shade off black, as the brief specifies.
      textSecondary: "#161616",
      textOnPrimary: "#FFFFFF",
      // Lime is a light ground: type on it must stay black.
      textOnAccent: "#000000",
      textOnContrast: "#FFFFFF",
      border: "#BFE9F7",
      chartSeries: ["#E4F577", "#000000", "#FFFFFF", "#7FD6F0"],
    },
  },
  {
    code: "eski_klassika",
    name: "Eski klassika",
    sortOrder: 8,
    tokens: {
      // Royal cobalt on every slide, so `background` and `contrast` are the same
      // colour: this family has no light ground to switch to.
      background: "#1738C5",
      surface: "#FFFFFF",
      // One step up from the ground. The print texture is built from it, which is
      // why it must stay within a few percent of the background.
      surfaceAlt: "#2044CF",
      contrast: "#1738C5",
      primary: "#1230B4",
      // The ghosted rows of the repeated-announcement composition. Readable as
      // type, but clearly a step behind the solid row.
      secondary: "#6F86DE",
      // Lime is decoration only — a rule, a marker. Never a word.
      accent: "#E4F577",
      // Both typographic voices are white, the script as much as the display.
      textPrimary: "#FFFFFF",
      // Body copy: white cooled by a trace of the ground, so it sits behind the
      // headline without ever reading as grey.
      textSecondary: "#DDE4FF",
      textOnPrimary: "#FFFFFF",
      textOnAccent: "#000000",
      textOnContrast: "#FFFFFF",
      border: "#4A63D6",
      chartSeries: ["#FFFFFF", "#E4F577", "#8FA3E8", "#DDE4FF"],
    },
  },
];

export const paletteByCode = new Map(paletteFamilies.map((family) => [family.code, family]));

export const defaultPaletteCode = "limon_tun";

export function resolvePalette(code: string | null | undefined): PaletteFamily {
  return paletteByCode.get(code ?? defaultPaletteCode) ?? paletteByCode.get(defaultPaletteCode)!;
}
