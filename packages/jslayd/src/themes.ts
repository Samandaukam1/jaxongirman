import { contrastRatio, deriveColorFamily, mix, readableOn } from "./colors.ts";
import type { ColorFamily } from "./document.ts";
import type { ColorRole } from "./spec.ts";

/**
 * The shared shelf of palettes, and why it is a catalogue rather than an engine.
 *
 * A design already carries its own `colorFamilies`, which is the right place
 * for a palette somebody drew for that design. What was missing is the other
 * direction: a deck about medicine wanting to look like medicine without its
 * author having chosen four blues by hand, and the same deck looking different
 * from the next one.
 *
 * So each entry here is a handful of authored roles, and nothing more. The
 * derivation — surfaces, muted text, ink that reads on primary, borders — is
 * `deriveColorFamily`, which already exists and which every design in the
 * product already goes through. A theme that computed its own family would be a
 * second opinion about what a palette is, and the first time the two disagreed
 * a themed slide would stop matching an authored one.
 *
 * Every variant is checked in `themes.test.mjs`: body text at 4.5:1 on both the
 * background and the surface, and ink on primary and accent at 4.5:1 too. A
 * palette that fails is not a taste question.
 */

export type ThemeFamilyId =
  | "medical" | "nature" | "business" | "technology" | "education" | "finance"
  | "luxury" | "creative" | "science" | "corporate" | "minimal" | "editorial"
  | "dark" | "warm" | "pastel" | "energetic";

export type ThemeVariant = {
  id: string;
  name: string;
  /** Only what is chosen; everything else is derived. */
  roles: Partial<Record<ColorRole, string>>;
};

export type ThemeFamily = {
  id: ThemeFamilyId;
  name: string;
  /** What this family is for, in the admin's language. */
  description: string;
  variants: readonly ThemeVariant[];
};

const family = (
  id: ThemeFamilyId,
  name: string,
  description: string,
  variants: readonly ThemeVariant[],
): ThemeFamily => ({ id, name, description, variants });

const variant = (id: string, name: string, roles: ThemeVariant["roles"]): ThemeVariant =>
  ({ id, name, roles });

export const THEME_FAMILIES: readonly ThemeFamily[] = [
  family("medical", "Tibbiyot", "Klinik, tinch, ishonchli", [
    variant("clinical", "Klinik ko‘k", { background: "#FFFFFF", primary: "#0B5CA8", accent: "#0E9BB5", text: "#0E1B2A", secondary: "#3E7FBF" }),
    variant("cyan", "Siyoh-moviy", { background: "#F5FAFD", primary: "#0A6E86", accent: "#12A5A0", text: "#0C1E26", secondary: "#3D8FA3" }),
    variant("navy", "To‘q ko‘k", { background: "#FFFFFF", primary: "#123A63", accent: "#1E7A9C", text: "#101C29", secondary: "#4A6E93" }),
    variant("teal", "Ko‘k-yashil", { background: "#F7FBFA", primary: "#0F6C63", accent: "#1B8FA0", text: "#0D1F1D", secondary: "#3E8A83" }),
  ]),
  family("nature", "Tabiat", "Organik, tinch, yerga yaqin", [
    variant("forest", "O‘rmon", { background: "#FBFCFA", primary: "#245A3A", accent: "#5C8A3C", text: "#14211A", secondary: "#4C7A5C" }),
    variant("sage", "Shuvoq", { background: "#F8FAF6", primary: "#4A6B4E", accent: "#7A9A5E", text: "#1B241C", secondary: "#6E8871" }),
    variant("olive", "Zaytun", { background: "#FCFBF6", primary: "#5A5B22", accent: "#8A7A2E", text: "#22220F", secondary: "#7C7D4A" }),
    variant("earth", "Tuproq", { background: "#FCFAF7", primary: "#6B4426", accent: "#9A6B32", text: "#241A12", secondary: "#8A6749" }),
  ]),
  family("business", "Biznes", "Aniq, ishonchli, zamonaviy", [
    variant("navy", "Navy", { background: "#FFFFFF", primary: "#132A52", accent: "#C2610C", text: "#111827", secondary: "#40587F" }),
    variant("cobalt", "Kobalt", { background: "#F7F9FC", primary: "#1E45A8", accent: "#C2610C", text: "#101728", secondary: "#4B6BC0" }),
    variant("charcoal", "Ko‘mir", { background: "#FBFBFC", primary: "#26292F", accent: "#B45309", text: "#16181C", secondary: "#565B65" }),
  ]),
  family("technology", "Texnologiya", "Aniq, tezkor, raqamli", [
    variant("indigo", "Indigo", { background: "#FFFFFF", primary: "#3730A3", accent: "#0891B2", text: "#111226", secondary: "#5B57C4" }),
    variant("slate", "Grafit", { background: "#F8FAFC", primary: "#1E293B", accent: "#0E7490", text: "#0F172A", secondary: "#475569" }),
    variant("violet", "Binafsha", { background: "#FBFAFF", primary: "#5B21B6", accent: "#0E7490", text: "#17132A", secondary: "#7C5AC7" }),
  ]),
  family("education", "Ta’lim", "Ochiq, do‘stona, tushunarli", [
    variant("sky", "Osmon", { background: "#FFFFFF", primary: "#1D4ED8", accent: "#C2610C", text: "#111827", secondary: "#4B72D8" }),
    variant("grass", "Maysa", { background: "#FAFCF8", primary: "#2F6B34", accent: "#B45309", text: "#152115", secondary: "#5A8A5E" }),
  ]),
  family("finance", "Moliya", "Vazmin, aniq, hisobli", [
    variant("emerald", "Zumrad", { background: "#FFFFFF", primary: "#0B5C43", accent: "#0B7C5A", text: "#0F1B17", secondary: "#3D7F6B" }),
    variant("graphite", "Grafit", { background: "#FAFAFB", primary: "#1F2937", accent: "#0B7C5A", text: "#111318", secondary: "#4B5563" }),
  ]),
  family("luxury", "Hashamat", "Sokin, qimmat, kam gapiradigan", [
    variant("obsidian", "Obsidian", { background: "#12100E", surface: "#1B1815", primary: "#C9A227", accent: "#E0C878", text: "#F5F1E8", secondary: "#A08A4E" }),
    variant("ivory", "Fil suyagi", { background: "#FBF8F1", primary: "#3A2E1A", accent: "#8A6B22", text: "#221B10", secondary: "#6B5A3A" }),
  ]),
  family("creative", "Ijodiy", "Jasur, energiyali, yodda qoladigan", [
    variant("magenta", "Fuksiya", { background: "#FFFFFF", primary: "#9D174D", accent: "#C2410C", text: "#1A1015", secondary: "#C04A7C" }),
    variant("electric", "Elektr", { background: "#FAF9FF", primary: "#4C1D95", accent: "#BE185D", text: "#15102A", secondary: "#7A4AC0" }),
  ]),
  family("science", "Fan", "Aniq, tekshirilgan, sovuq", [
    variant("cobalt", "Kobalt", { background: "#FFFFFF", primary: "#1E3A8A", accent: "#0E7490", text: "#0F172A", secondary: "#4763AE" }),
    variant("plasma", "Plazma", { background: "#F7F8FC", primary: "#3B2E8A", accent: "#0B7C5A", text: "#131228", secondary: "#6659B0" }),
  ]),
  family("corporate", "Korporativ", "Rasmiy, barqaror, neytral", [
    variant("steel", "Po‘lat", { background: "#FFFFFF", primary: "#274156", accent: "#8A5A1E", text: "#141B22", secondary: "#546C80" }),
    variant("stone", "Tosh", { background: "#FAFAF9", primary: "#3F3F46", accent: "#0B5C43", text: "#18181B", secondary: "#6B7280" }),
  ]),
  family("minimal", "Minimal", "Kam rang, ko‘p havo", [
    variant("paper", "Qog‘oz", { background: "#FFFFFF", primary: "#111111", accent: "#5A5A5A", text: "#111111", secondary: "#555555" }),
    variant("bone", "Suyak", { background: "#F7F6F3", primary: "#1A1A18", accent: "#6B655A", text: "#1A1A18", secondary: "#5C574E" }),
  ]),
  family("editorial", "Nashriyot", "Jurnal ruhi, kuchli tipografika", [
    variant("ink", "Siyoh", { background: "#FDFCFA", primary: "#1A1A1A", accent: "#9E2B25", text: "#141414", secondary: "#4A4A4A" }),
    variant("crimson", "Qirmizi", { background: "#FFFFFF", primary: "#7F1D1D", accent: "#1F2937", text: "#171313", secondary: "#A14A4A" }),
  ]),
  family("dark", "Qorong‘i", "Ekran uchun, sahnaga yaqin", [
    variant("midnight", "Yarim tun", { background: "#0F1117", surface: "#171A22", primary: "#7C9CF5", accent: "#4ED8A8", text: "#F2F4F8", secondary: "#9BA9C4" }),
    variant("carbon", "Uglerod", { background: "#121212", surface: "#1B1B1B", primary: "#E0E0E0", accent: "#F0A93C", text: "#F5F5F5", secondary: "#A8A8A8" }),
  ]),
  family("warm", "Iliq", "Quyoshli, mehmondo‘st", [
    variant("terracotta", "Terrakota", { background: "#FFFBF7", primary: "#9A3412", accent: "#B45309", text: "#21150F", secondary: "#B4633C" }),
    variant("amber", "Kahrabo", { background: "#FFFCF5", primary: "#7C4A03", accent: "#A16207", text: "#1F1708", secondary: "#A8762A" }),
  ]),
  family("pastel", "Pastel", "Yumshoq, sokin, yengil", [
    variant("blush", "Pushti", { background: "#FFFAFB", primary: "#8A3A5A", accent: "#5A6BA8", text: "#241419", secondary: "#B06A85" }),
    variant("mint", "Yalpiz", { background: "#F8FCFA", primary: "#2F6B5A", accent: "#5A6BA8", text: "#12211C", secondary: "#5E8F80" }),
  ]),
  family("energetic", "Energiya", "Tez, baland, harakatli", [
    variant("sunset", "Shafaq", { background: "#FFFFFF", primary: "#C2410C", accent: "#7C3AED", text: "#1A1210", secondary: "#D4703F" }),
    variant("volt", "Volt", { background: "#FCFCF7", primary: "#3F6212", accent: "#C2410C", text: "#161A0F", secondary: "#6E8A3A" }),
  ]),
];

const BY_ID = new Map(THEME_FAMILIES.map((entry) => [entry.id, entry]));

export const themeFamily = (id: string): ThemeFamily | null => BY_ID.get(id as ThemeFamilyId) ?? null;

/**
 * A variant, as a full family the renderer can use.
 *
 * Straight through `deriveColorFamily`, so a theme and a hand-authored palette
 * are the same kind of object by the time anything draws with them.
 */
export function themePalette(familyId: string, variantId?: string): ColorFamily | null {
  const found = themeFamily(familyId);
  if (!found) return null;
  const chosen = variantId
    ? found.variants.find((entry) => entry.id === variantId) ?? found.variants[0]
    : found.variants[0];
  return chosen ? deriveColorFamily(chosen.roles) : null;
}

/** Every variant of every family, flattened — what a picker lists. */
export function themeVariants(): { familyId: ThemeFamilyId; familyName: string; variant: ThemeVariant }[] {
  return THEME_FAMILIES.flatMap((entry) => entry.variants.map((v) => ({
    familyId: entry.id, familyName: entry.name, variant: v,
  })));
}

/**
 * Gradient presets, expressed in roles rather than in hex.
 *
 * A gradient written as two literals belongs to one palette; the same gradient
 * written as `primary → accent` follows whichever theme is applied, which is
 * what makes switching theme in the studio change the canvas rather than
 * change half of it.
 */
export type GradientPreset = {
  id: string;
  name: string;
  type: "linear" | "radial";
  angle: number;
  stops: readonly { role: ColorRole; position: number; opacity?: number }[];
};

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: "primary-accent", name: "Asosiy → urg‘u", type: "linear", angle: 135, stops: [
    { role: "primary", position: 0 }, { role: "accent", position: 100 }] },
  { id: "surface-lift", name: "Yuza ko‘tarilishi", type: "linear", angle: 180, stops: [
    { role: "surface", position: 0 }, { role: "background", position: 100 }] },
  { id: "tri-brand", name: "Uch bosqichli brend", type: "linear", angle: 120, stops: [
    { role: "primary", position: 0 }, { role: "secondary", position: 50 }, { role: "accent", position: 100 }] },
  { id: "quad-editorial", name: "To‘rt bosqichli", type: "linear", angle: 160, stops: [
    { role: "primary", position: 0 }, { role: "secondary", position: 35 },
    { role: "accent", position: 70 }, { role: "surface", position: 100 }] },
  { id: "radial-spot", name: "Markaziy nur", type: "radial", angle: 0, stops: [
    { role: "accent", position: 0, opacity: 0.35 }, { role: "background", position: 100 }] },
  { id: "veil", name: "Rasm ustidagi parda", type: "linear", angle: 180, stops: [
    { role: "contrast", position: 0, opacity: 0 }, { role: "contrast", position: 100, opacity: 0.72 }] },
];

/**
 * Whether a family is safe to draw a deck in, and what is wrong when it is not.
 *
 * The check is the one a reader performs: can the body text be read on the two
 * grounds it sits on, and can the ink on a primary or accent fill be read on it.
 */
export function auditFamily(colors: ColorFamily): string[] {
  const problems: string[] = [];
  const check = (fg: string, bg: string, floor: number, what: string) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < floor) problems.push(`${what}: ${ratio.toFixed(2)}:1 (kamida ${floor})`);
  };
  check(colors.text, colors.background, 4.5, "matn / fon");
  check(colors.text, colors.surface, 4.5, "matn / yuza");
  check(colors.textSecondary, colors.background, 3, "ikkilamchi matn / fon");
  check(colors.textOnPrimary, colors.primary, 4.5, "matn / asosiy");
  check(colors.textOnAccent, colors.accent, 4.5, "matn / urg‘u");
  return problems;
}

export { mix, readableOn };
