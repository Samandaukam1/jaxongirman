/**
 * The visual language one presentation is written in.
 *
 * Not a template: it fixes no composition, no element and no geometry. It
 * fixes the things that have to agree across ten slides for them to look like
 * one document — the ground they sit on, the ink they are set in, the corner
 * radius, the rhythm of the spacing, which font carries which job.
 *
 * A model chooses the *direction* here, in words: dark or light, editorial or
 * geometric, warm or cool. Everything a direction implies — the actual colour
 * values, the contrast between them, which of the fonts we hold matches — is
 * computed. That split matters: a model asked for a palette returns six
 * plausible hexes, and plausible hexes fail contrast. A model asked for a mood,
 * with the palette derived, cannot.
 */

import { COLOR_ROLES, FONT_ROLES, type ColorRole, type FontRole } from "./scene-spec.ts";

/* ------------------------------------------------------------------ colour */

export type Rgb = { r: number; g: number; b: number };

export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((one) => Math.max(0, Math.min(255, Math.round(one))).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance. The one number every contrast rule is built on. */
export function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = luminance(a) >= luminance(b) ? [a, b] : [b, a];
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

const mix = (a: Rgb, b: Rgb, amount: number): Rgb => ({
  r: a.r + (b.r - a.r) * amount,
  g: a.g + (b.g - a.g) * amount,
  b: a.b + (b.b - a.b) * amount,
});

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Ink that can actually be read on this ground.
 *
 * Walked toward black or white until it passes, rather than picked and hoped
 * for. A palette that fails contrast is not a style choice; it is a slide
 * nobody at the back of the room can read.
 */
export function readableOn(ground: Rgb, preferred: Rgb, target = 4.5): Rgb {
  if (contrastRatio(ground, preferred) >= target) return preferred;
  const toward = luminance(ground) > 0.5 ? BLACK : WHITE;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(preferred, toward, step / 20);
    if (contrastRatio(ground, candidate) >= target) return candidate;
  }
  return toward;
}

/* --------------------------------------------------------------------- DNA */

export const MOODS = ["editorial", "cinematic", "geometric", "clinical", "warm", "civic"] as const;
export type Mood = (typeof MOODS)[number];

export const GROUNDS = ["near_black", "warm_white", "cool_white", "deep_brand"] as const;
export type Ground = (typeof GROUNDS)[number];

export type DesignDirection = {
  mood: Mood;
  ground: Ground;
  /** One hex the deck is built around. Everything else is derived from it. */
  brand: string;
  cornerLanguage: "sharp" | "soft" | "pill";
  gradients: boolean;
};

export type DesignDNA = {
  direction: DesignDirection;
  colors: Record<ColorRole, string>;
  fonts: Record<FontRole, string>;
  radius: number;
  spacing: number;
};

const GROUND_BASE: Record<Ground, { background: Rgb; surface: Rgb }> = {
  near_black: { background: { r: 14, g: 15, b: 18 }, surface: { r: 26, g: 28, b: 33 } },
  warm_white: { background: { r: 250, g: 248, b: 244 }, surface: { r: 255, g: 255, b: 255 } },
  cool_white: { background: { r: 246, g: 248, b: 251 }, surface: { r: 255, g: 255, b: 255 } },
  deep_brand: { background: { r: 18, g: 22, b: 34 }, surface: { r: 28, g: 34, b: 50 } },
};

const RADIUS: Record<DesignDirection["cornerLanguage"], number> = { sharp: 0, soft: 28, pill: 44 };

/**
 * The palette, derived rather than chosen.
 *
 * Body copy is held to 4.5:1 and large type to 3:1 — the thresholds a person
 * with ordinary eyesight and a projector need. Text over a photograph is a
 * separate case: it is always white or always near-black, because the
 * photograph underneath is not known when the palette is built, and the scene
 * puts a scrim behind it.
 */
export function derivePalette(direction: DesignDirection): Record<ColorRole, string> {
  const base = GROUND_BASE[direction.ground];
  const brand = parseHex(direction.brand) ?? { r: 90, g: 120, b: 240 };
  const onDark = luminance(base.background) < 0.5;

  const ink = readableOn(base.background, onDark ? WHITE : BLACK, 7);
  const inkMuted = readableOn(base.background, mix(ink, base.background, 0.35), 4.5);
  const primary = readableOn(base.background, brand, 3);
  const accent = readableOn(base.background, mix(brand, onDark ? WHITE : BLACK, 0.25), 3);

  // Chart colours step away from the brand rather than sampling a rainbow, and
  // each is held readable on the ground it is drawn against.
  const chart = [0, 0.28, 0.52, 0.74].map((amount) =>
    readableOn(base.background, mix(brand, onDark ? WHITE : BLACK, amount), 3));

  return {
    background: toHex(base.background),
    surface: toHex(base.surface),
    ink: toHex(ink),
    inkMuted: toHex(inkMuted),
    // Over a photograph the scrim decides the ground, so this is the one
    // colour that does not follow the palette.
    onImage: "#ffffff",
    primary: toHex(primary),
    accent: toHex(accent),
    chart1: toHex(chart[0]!),
    chart2: toHex(chart[1]!),
    chart3: toHex(chart[2]!),
    chart4: toHex(chart[3]!),
  };
}

/* ------------------------------------------------------------------- fonts */

export type LibraryFamily = { name: string; category: string | null };

/**
 * Which of the fonts we hold suits which job.
 *
 * The library is the only source: a model naming a font we do not have gets a
 * deck set in a fallback nobody chose, which is how a "geometric futuristic"
 * presentation arrives in Helvetica. So the mood picks a *category* order and
 * the first family we actually hold in that order wins.
 */
const CATEGORY_ORDER: Record<Mood, Record<FontRole, string[]>> = {
  editorial: {
    display: ["serif", "display"], heading: ["serif", "sans-serif"], body: ["sans-serif", "serif"],
    data: ["sans-serif", "monospace"], quote: ["serif", "display"],
  },
  cinematic: {
    display: ["display", "sans-serif"], heading: ["sans-serif", "display"], body: ["sans-serif"],
    data: ["sans-serif", "monospace"], quote: ["serif", "display"],
  },
  geometric: {
    display: ["sans-serif", "display"], heading: ["sans-serif"], body: ["sans-serif"],
    data: ["monospace", "sans-serif"], quote: ["sans-serif"],
  },
  clinical: {
    display: ["sans-serif"], heading: ["sans-serif"], body: ["sans-serif"],
    data: ["monospace", "sans-serif"], quote: ["sans-serif", "serif"],
  },
  warm: {
    display: ["serif", "handwriting", "display"], heading: ["serif", "sans-serif"], body: ["sans-serif", "serif"],
    data: ["sans-serif"], quote: ["serif"],
  },
  civic: {
    display: ["sans-serif", "serif"], heading: ["sans-serif"], body: ["sans-serif"],
    data: ["sans-serif", "monospace"], quote: ["serif", "sans-serif"],
  },
};

export function pairFonts(mood: Mood, library: readonly LibraryFamily[]): Record<FontRole, string> | null {
  const usable = library.filter((family) => family.name.trim().length > 0);
  if (usable.length === 0) return null;

  const byCategory = new Map<string, string[]>();
  for (const family of usable) {
    const key = (family.category ?? "sans-serif").toLowerCase();
    const list = byCategory.get(key) ?? [];
    list.push(family.name);
    byCategory.set(key, list);
  }

  const order = CATEGORY_ORDER[mood];
  const chosen = {} as Record<FontRole, string>;
  for (const role of FONT_ROLES) {
    let picked: string | null = null;
    for (const category of order[role]) {
      const names = byCategory.get(category);
      if (names && names.length > 0) {
        // A display face and a body face should not be the same file when the
        // library can offer two; the deck reads as one weight otherwise.
        picked = names.find((name) => !Object.values(chosen).includes(name)) ?? names[0]!;
        break;
      }
    }
    chosen[role] = picked ?? usable[0]!.name;
  }
  return chosen;
}

export function buildDNA(direction: DesignDirection, library: readonly LibraryFamily[]): DesignDNA | null {
  const fonts = pairFonts(direction.mood, library);
  if (!fonts) return null;
  return {
    direction,
    colors: derivePalette(direction),
    fonts,
    radius: RADIUS[direction.cornerLanguage],
    // One spacing unit the whole deck is measured in, so gaps between cards,
    // padding inside them and the rhythm between bands are all multiples of
    // one number rather than of six different ones.
    spacing: 8,
  };
}

/** Every colour role a scene may name, so nothing reads an undefined value. */
export function paletteIsComplete(colors: Record<string, string>): boolean {
  return COLOR_ROLES.every((role) => typeof colors[role] === "string" && /^#[0-9a-f]{6}$/i.test(colors[role]!));
}
