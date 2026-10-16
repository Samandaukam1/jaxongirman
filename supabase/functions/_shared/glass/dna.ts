/**
 * A deck's design, invented for that deck.
 *
 * Nothing here is a template. There is no list of themes and no picture made
 * in advance: a deck's palette, its pair of typefaces, the shape of its light
 * and the language of its glass are all computed at generation time from two
 * inputs — an art direction the model gives for the topic (a hue, a mood,
 * light or dark, a typographic voice) and a seed. Change either and the deck
 * looks different; keep both and it is reproducible.
 *
 * What the engine does carry is knowledge, not designs: which typefaces in the
 * library are good enough to set a slide in and what each is like, and how
 * colour behaves. A designer brings the same to every brief and still starts
 * every brief from nothing.
 */

import { alpha, contrast, hashOf, legible, oklch, over, random, turn } from "./color.ts";
import { hex, NAQSH_FAMILIES, nearestFamily, toWhite, type NaqshFamily } from "./naqsh-palette.ts";
import { MOZAIKA_FAMILIES } from "./mozaika.ts";
import { SPEKTR_FAMILIES } from "./spektr.ts";

/* -------------------------------------------------------- art direction */

export const MOODS = ["cosmic", "elegant", "fresh", "warm", "tech", "classic", "playful", "corporate"] as const;
export type Mood = (typeof MOODS)[number];
export const TYPOGRAPHY = ["serif", "sans", "mixed"] as const;
export type Typography = (typeof TYPOGRAPHY)[number];

export type ArtDirection = {
  mode: "dark" | "light";
  /** The topic's own colour, 0–360. */
  hue: number;
  mood: Mood;
  typography: Typography;
  energy: "calm" | "vivid";
};

export function artDirectionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["dark", "light"], description: "Mavzu ruhiga mos: qorong‘i (kosmik, texnologik, hashamatli) yoki yorug‘ (ta’lim, tibbiyot, tabiat)" },
      hue: { type: "integer", description: "Mavzuning asosiy rangi, 0–360 (0 qizil, 40 to‘q sariq, 60 sariq, 140 yashil, 190 moviy, 230 ko‘k, 275 binafsha, 320 pushti)" },
      mood: { type: "string", enum: [...MOODS] },
      typography: { type: "string", enum: [...TYPOGRAPHY], description: "serif — klassik/adabiy, sans — zamonaviy/texnik, mixed — nafis aralash" },
      energy: { type: "string", enum: ["calm", "vivid"] },
    },
    required: ["mode", "hue", "mood", "typography", "energy"],
  };
}

/** The direction as the model gave it, or one derived from the topic alone. */
export function readArtDirection(value: unknown, topic: string): ArtDirection {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seed = hashOf(topic.toLowerCase());
  const pick = <T>(list: readonly T[], offset: number) => list[(seed >>> offset) % list.length]!;
  const hue = typeof raw.hue === "number" && Number.isFinite(raw.hue) ? turn(Math.round(raw.hue), 0) : seed % 360;
  return {
    mode: raw.mode === "dark" || raw.mode === "light" ? raw.mode : pick(["dark", "light"] as const, 3),
    hue,
    mood: (MOODS as readonly string[]).includes(String(raw.mood)) ? raw.mood as Mood : pick(MOODS, 5),
    typography: (TYPOGRAPHY as readonly string[]).includes(String(raw.typography)) ? raw.typography as Typography : pick(TYPOGRAPHY, 7),
    energy: raw.energy === "calm" || raw.energy === "vivid" ? raw.energy : pick(["calm", "vivid"] as const, 11),
  };
}

/* ------------------------------------------------------------ typefaces */

export type FontPick = {
  family: string;
  weight: number;
  /** Average advance of mixed Uzbek Latin text, in em — measured from the files. */
  em: number;
  tracking?: number;
};

type Display = { family: string; weight: number; em: number; moods: Mood[]; serif: boolean };
type Body = { family: string; light: [number, number]; regular: [number, number]; strong: [number, number]; moods: Mood[]; serif: boolean };

/**
 * Faces fit to set a slide in, with what they are like.
 *
 * Measured, not recalled: every `em` is the average advance of a sample of
 * Uzbek Latin taken from the font file in the library bucket, and every face
 * here was checked to carry ‘ and ’ — the apostrophes o‘ and g‘ are written
 * with. A face the operator switches off in the library is skipped at run
 * time, so this is a shortlist, never a promise.
 */
const DISPLAYS: Display[] = [
  { family: "Instrument Serif", weight: 400, em: 0.346, moods: ["elegant", "cosmic", "warm"], serif: true },
  { family: "DM Serif Display", weight: 400, em: 0.446, moods: ["elegant", "warm", "classic", "playful"], serif: true },
  { family: "Gloock", weight: 400, em: 0.461, moods: ["classic", "corporate", "elegant", "cosmic"], serif: true },
  { family: "Young Serif", weight: 400, em: 0.513, moods: ["warm", "playful", "fresh"], serif: true },
  { family: "Prata", weight: 400, em: 0.478, moods: ["elegant", "classic", "warm"], serif: true },
  { family: "Gilda Display", weight: 400, em: 0.464, moods: ["elegant", "warm", "fresh"], serif: true },
  { family: "Libre Caslon Display", weight: 400, em: 0.375, moods: ["elegant", "classic"], serif: true },
  { family: "Playfair Display SC", weight: 700, em: 0.549, moods: ["classic"], serif: true },
  { family: "Old Standard TT", weight: 700, em: 0.459, moods: ["classic", "corporate"], serif: true },
  { family: "IBM Plex Serif", weight: 600, em: 0.497, moods: ["corporate", "classic", "tech"], serif: true },
  { family: "Poppins", weight: 700, em: 0.517, moods: ["playful", "fresh", "corporate"], serif: false },
  { family: "Be Vietnam Pro", weight: 700, em: 0.514, moods: ["corporate", "tech", "fresh", "cosmic"], serif: false },
  { family: "Kanit", weight: 600, em: 0.467, moods: ["tech", "cosmic", "playful"], serif: false },
  { family: "Prompt", weight: 600, em: 0.496, moods: ["fresh", "playful", "warm"], serif: false },
  { family: "Barlow", weight: 700, em: 0.434, moods: ["corporate", "tech"], serif: false },
  { family: "Fira Sans", weight: 700, em: 0.458, moods: ["corporate", "tech", "fresh"], serif: false },
  { family: "Lato", weight: 900, em: 0.451, moods: ["corporate", "fresh"], serif: false },
  { family: "Sarabun", weight: 700, em: 0.458, moods: ["fresh", "corporate", "warm"], serif: false },
];

const BODIES: Body[] = [
  { family: "Be Vietnam Pro", light: [300, 0.483], regular: [400, 0.494], strong: [600, 0.507], moods: ["corporate", "tech", "cosmic", "elegant", "fresh"], serif: false },
  { family: "Poppins", light: [300, 0.482], regular: [400, 0.491], strong: [600, 0.509], moods: ["playful", "fresh", "warm", "elegant"], serif: false },
  { family: "Lato", light: [300, 0.432], regular: [400, 0.441], strong: [700, 0.448], moods: ["elegant", "classic", "corporate", "warm", "fresh"], serif: false },
  { family: "Fira Sans", light: [300, 0.443], regular: [400, 0.452], strong: [600, 0.456], moods: ["corporate", "tech", "classic"], serif: false },
  { family: "Kanit", light: [300, 0.445], regular: [400, 0.453], strong: [500, 0.459], moods: ["tech", "cosmic"], serif: false },
  { family: "Prompt", light: [300, 0.478], regular: [400, 0.485], strong: [500, 0.492], moods: ["fresh", "playful", "warm"], serif: false },
  { family: "Barlow", light: [300, 0.417], regular: [400, 0.42], strong: [600, 0.429], moods: ["corporate", "tech", "cosmic"], serif: false },
  { family: "Sarabun", light: [300, 0.434], regular: [400, 0.44], strong: [600, 0.452], moods: ["fresh", "warm", "elegant"], serif: false },
  { family: "IBM Plex Serif", light: [300, 0.474], regular: [400, 0.485], strong: [600, 0.497], moods: ["classic", "corporate"], serif: true },
  { family: "PT Serif", light: [400, 0.456], regular: [400, 0.456], strong: [700, 0.492], moods: ["classic", "warm"], serif: true },
];

/** The weights each candidate needs, so availability can be checked before choosing. */
export function candidateFaces(): { family: string; weights: number[] }[] {
  const wanted = new Map<string, Set<number>>();
  const add = (family: string, weight: number) => {
    const set = wanted.get(family) ?? new Set<number>();
    set.add(weight);
    wanted.set(family, set);
  };
  for (const display of DISPLAYS) add(display.family, display.weight);
  for (const body of BODIES) for (const [weight] of [body.light, body.regular, body.strong]) add(body.family, weight);
  return [...wanted].map(([family, weights]) => ({ family, weights: [...weights].sort() }));
}

export type ThemeFonts = { display: FontPick; title: FontPick; strong: FontPick; body: FontPick; label: FontPick };

/**
 * A pair of faces for this deck.
 *
 * Weighted towards faces whose character suits the mood and drawn with the
 * deck's seed, so two decks on one subject do not share a typeface by
 * default. `available` is what the library actually holds right now.
 */
export function pairFonts(direction: ArtDirection, next: () => number, available: (family: string, weight: number) => boolean): ThemeFonts {
  const has = (display: Display) => available(display.family, display.weight);
  const hasBody = (body: Body) => [body.light, body.regular, body.strong].every(([weight]) => available(body.family, weight));
  const weighted = <T extends { moods: Mood[] }>(pool: T[]): T | null => {
    if (pool.length === 0) return null;
    const weights = pool.map((entry) => (entry.moods.includes(direction.mood) ? 4 : 1) * (entry.moods[0] === direction.mood ? 1.6 : 1));
    let roll = next() * weights.reduce((sum, weight) => sum + weight, 0);
    for (const [index, entry] of pool.entries()) {
      roll -= weights[index]!;
      if (roll <= 0) return entry;
    }
    return pool[pool.length - 1]!;
  };

  const wantSerif = direction.typography !== "sans";
  const display = weighted(DISPLAYS.filter((entry) => entry.serif === wantSerif && has(entry)))
    ?? weighted(DISPLAYS.filter(has));

  // A sans display usually sets its own body — one family, two weights, the
  // way most modern identities are built. A serif display gets a sans body
  // except where the mood is literary, which earns a serif text face.
  const sameFamily = display && !display.serif ? BODIES.find((body) => body.family === display.family && hasBody(body)) : undefined;
  const serifBody = direction.typography === "serif" && (direction.mood === "classic" || direction.mood === "warm") && next() < 0.5;
  const body = (sameFamily && next() < 0.7 ? sameFamily : null)
    ?? weighted(BODIES.filter((entry) => entry.serif === serifBody && hasBody(entry) && entry.family !== display?.family))
    ?? weighted(BODIES.filter(hasBody));

  const fallbackBody: Body = { family: "Manrope", light: [400, 0.5], regular: [400, 0.5], strong: [700, 0.52], moods: [], serif: false };
  const chosenBody = body ?? fallbackBody;
  const chosenDisplay: FontPick = display
    ? { family: display.family, weight: display.weight, em: display.em }
    : { family: "Manrope", weight: 700, em: 0.52 };

  const light = direction.mode === "dark" ? chosenBody.light : chosenBody.regular;
  return {
    display: chosenDisplay,
    title: chosenDisplay,
    strong: { family: chosenBody.family, weight: chosenBody.strong[0], em: chosenBody.strong[1] },
    body: { family: chosenBody.family, weight: light[0], em: light[1] },
    label: { family: chosenBody.family, weight: chosenBody.strong[0], em: chosenBody.strong[1], tracking: 2.2 },
  };
}

/* --------------------------------------------------------------- the dna */

export const MOTIFS = ["orbs", "ribbons", "halo", "mesh"] as const;
export type Motif = (typeof MOTIFS)[number];

/**
 * The two visual languages a deck can be set in.
 *
 * `glass` — light behind translucent cards, spheres and ribbons.
 * `editorial` — the magazine page: flat paper or ink, colour blocks, hairline
 * rules, square marks, photographs to the edge.
 * `soft3d` — a device: one near-grey material, cards raised out of it and
 * wells pressed into it, a single neon indicator colour.
 * `corporate` — the business template: white ground, one brand colour in
 * large rounded gradient forms bleeding off the page, white cards floating on
 * soft shadows, rounded photographs, dot grids, two-tone titles.
 * `naqsh` — national ornament made modern: a white page on a faint girih,
 * a band of bodom in the family's gradient down one edge, eight-pointed stars
 * for numbers and bullets, photographs in the arch of a peshtoq, a tilework
 * wall to close on.
 * `spektr` — the infographic deck: hero pages that are one vivid gradient
 * field with white words and a giant line icon off the right edge, and white
 * pages where every figure, icon and card takes its own colour of a spectrum.
 * `mozaika` — the geometric deck: a Bauhaus mosaic of quarter and half discs,
 * rings, leaves, arches, stripes and rays, generated cell by cell; hero pages
 * a field of the family's colour beside a block of it, white pages with a
 * column of it down one edge, figures and icons in a spectrum.
 * All fit any subject; all are composed by the same layouts, measured the
 * same way and checked by the same rules — only the drawing differs.
 */
export const STYLES = ["glass", "editorial", "soft3d", "corporate", "naqsh", "spektr", "mozaika"] as const;
export type DeckStyle = (typeof STYLES)[number];

/**
 * The colour families an author may ask for, as the hue each one is centred
 * on. The deck still invents its palette — the harmony, the lightness, the
 * accents — inside the family; only its main hue is taken from here.
 */
export const PALETTES = { blue: 245, teal: 192, green: 150, gold: 82, orange: 45, red: 18, pink: 342, violet: 285 } as const;
export type PaletteFamily = keyof typeof PALETTES;

/** What the create screen sent, kept only when it names a real style and family. */
export type DesignRequest = { style: DeckStyle; palette: PaletteFamily | null };

export function readDesignRequest(value: unknown): DesignRequest | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!raw || !(STYLES as readonly string[]).includes(String(raw.style))) return null;
  const palette = typeof raw.palette === "string" && raw.palette in PALETTES ? raw.palette as PaletteFamily : null;
  return { style: raw.style as DeckStyle, palette };
}

/** How an editorial deck draws a card: a tint, an outline, or only a rule over it. */
export type PanelLook = "tint" | "outline" | "rule";

export type DesignDNA = {
  seed: number;
  direction: ArtDirection;
  style: DeckStyle;
  panelLook: PanelLook;
  motif: Motif;
  radius: number;
  colors: {
    ground: string;
    ground2: string;
    ink: string;
    inkSoft: string;
    accent: string;
    accent2: string;
    onAccent: string;
    glass: string;
    glassStrong: string;
    sheen: string;
    rim: string;
    shadow: string;
    /** The light sources behind the glass, strongest first. */
    glows: [string, string, string, string];
    /** Series colours, at least four; a Spektr deck carries five, one per figure on a page. */
    chart: [string, string, string, string, ...string[]];
    /** A card's flat fill (editorial), and a stronger one for the main panel. */
    panel: string;
    panelStrong: string;
    /** Hairlines: rules, outlines, grid marks. */
    line: string;
    /** A colour field — the cover band, the closing page — and the ink set on it. */
    block: string;
    onBlock: string;
  };
  fonts: ThemeFonts;
  /** How strongly the light shows, 0–1. */
  intensity: number;
  /** For a naqsh deck: the family its ornament pictures were drawn in. */
  ornament?: NaqshFamily;
  /** For a mozaika deck: the mosaic's colours on the white page and on the hero field. */
  tiles?: { page: string[]; hero: string[] };
};

/** Hue offsets of the four light sources, by mood. A harmony, not a palette. */
const HARMONY: Record<Mood, [number, number, number, number]> = {
  cosmic: [0, 52, -58, 168],
  elegant: [0, 24, -22, 180],
  fresh: [0, 38, -46, 92],
  warm: [0, 28, -30, 196],
  tech: [0, 180, 42, -38],
  classic: [0, 18, 38, -16],
  playful: [0, 120, 240, 60],
  corporate: [0, 14, 182, -24],
};

const MOTIF_BY_MOOD: Record<Mood, Motif[]> = {
  cosmic: ["orbs", "ribbons", "orbs", "halo"],
  elegant: ["halo", "orbs", "ribbons"],
  fresh: ["mesh", "orbs", "orbs"],
  warm: ["mesh", "ribbons", "orbs"],
  tech: ["ribbons", "halo", "orbs"],
  classic: ["halo", "mesh"],
  playful: ["orbs", "mesh", "orbs"],
  corporate: ["mesh", "halo", "ribbons"],
};

const RADIUS: Record<Mood, [number, number]> = {
  cosmic: [20, 26], elegant: [16, 24], fresh: [22, 28], warm: [20, 26],
  tech: [12, 18], classic: [8, 14], playful: [24, 32], corporate: [10, 16],
};

export function buildDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
  style?: DeckStyle;
}): DesignDNA {
  if (input.style === "editorial") return editorialDNA(input);
  if (input.style === "soft3d") return softDNA(input);
  if (input.style === "corporate") return corporateDNA(input);
  if (input.style === "naqsh") return naqshDNA(input);
  if (input.style === "spektr") return spektrDNA(input);
  if (input.style === "mozaika") return mozaikaDNA(input);
  const { direction, seed } = input;
  const next = random(seed);
  const dark = direction.mode === "dark";
  const vivid = direction.energy === "vivid";
  // A few degrees of the deck's own, so one hue never yields one palette.
  const hue = turn(direction.hue, Math.round((next() - 0.5) * 16));
  const offsets = HARMONY[direction.mood].map((offset) => offset + Math.round((next() - 0.5) * 14));
  const hues = offsets.map((offset) => turn(hue, offset)) as [number, number, number, number];

  const ground = dark
    ? oklch(0.17 + next() * 0.03, 0.035 + next() * 0.025, hue)
    : oklch(0.975 - next() * 0.012, 0.012 + next() * 0.012, turn(hue, 10));
  const ground2 = dark
    ? oklch(0.1 + next() * 0.02, 0.03, turn(hue, 24))
    : oklch(0.93 + next() * 0.015, 0.025 + next() * 0.015, turn(hue, -18));

  const glowL = dark ? (vivid ? 0.66 : 0.56) : (vivid ? 0.84 : 0.89);
  const glowC = dark ? (vivid ? 0.23 : 0.15) : (vivid ? 0.13 : 0.085);
  const glows = hues.map((h, index) =>
    oklch(glowL + (index === 3 ? (dark ? -0.12 : 0.03) : (next() - 0.5) * 0.06), glowC * (index === 3 ? 0.7 : 1), h)) as DesignDNA["colors"]["glows"];

  /**
   * Cards are translucent, so the ink has to read on the card over the ground
   * as well as on the ground itself. Both are checked.
   */
  const glass = dark ? alpha("#FFFFFF", 0.07 + next() * 0.03) : alpha("#FFFFFF", 0.54 + next() * 0.08);
  const cardOverGround = over(glass, ground);
  const cardOverGlow = over(glass, over(alpha(glows[0], 0.55), ground));
  const grounds = [ground, ground2, cardOverGround, cardOverGlow];

  const ink = legible({ l: dark ? 0.97 : 0.2, c: dark ? 0.012 : 0.04, h: hue, grounds, ratio: 7, dark });
  const inkSoft = legible({ l: dark ? 0.8 : 0.42, c: dark ? 0.03 : 0.045, h: hue, grounds, ratio: 4.6, dark });
  const accent = legible({ l: dark ? 0.84 : 0.55, c: dark ? 0.14 : 0.17, h: hues[1], grounds, ratio: 4.6, dark });
  const accent2 = legible({ l: dark ? 0.8 : 0.5, c: dark ? 0.13 : 0.15, h: hues[2], grounds: [ground, cardOverGround], ratio: 3.2, dark });
  const onAccent = contrast("#FFFFFF", accent) >= contrast(ground2, accent) ? "#FFFFFF" : ground2;

  const chart = hues.map((h, index) => oklch(
    dark ? 0.78 - index * 0.04 : 0.58 + index * 0.04,
    dark ? 0.15 : 0.16,
    index === 0 ? turn(h, 0) : h,
  )) as DesignDNA["colors"]["chart"];

  const [low, high] = RADIUS[direction.mood];
  const motifs = MOTIF_BY_MOOD[direction.mood];
  const glassStrong = dark ? alpha("#FFFFFF", 0.13 + next() * 0.03) : alpha("#FFFFFF", 0.72 + next() * 0.06);
  const rim = dark ? alpha(oklch(0.92, 0.05, hues[1]), 0.26 + next() * 0.08) : alpha("#FFFFFF", 0.94);
  return {
    seed,
    direction: { ...direction, hue },
    style: "glass",
    panelLook: "tint",
    motif: motifs[Math.floor(next() * motifs.length)]!,
    radius: Math.round(low + next() * (high - low)),
    colors: {
      ground,
      ground2,
      ink,
      inkSoft,
      accent,
      accent2,
      onAccent,
      glass,
      glassStrong,
      sheen: dark ? alpha("#FFFFFF", 0.2 + next() * 0.06) : alpha("#FFFFFF", 0.9),
      rim,
      shadow: dark ? "#000000" : oklch(0.32, 0.07, hue),
      glows,
      chart,
      panel: glass,
      panelStrong: glassStrong,
      line: rim,
      block: accent,
      onBlock: onAccent,
    },
    fonts: pairFonts(direction, next, input.available),
    intensity: dark ? (vivid ? 0.9 : 0.72) : (vivid ? 0.85 : 0.7),
  };
}

/* --------------------------------------------------------- editorial */

/** Corner radius of an editorial deck: square for the serious moods, a little softer for the light ones. */
const EDITORIAL_RADIUS: Record<Mood, [number, number]> = {
  cosmic: [0, 4], elegant: [0, 2], fresh: [4, 8], warm: [2, 6],
  tech: [0, 2], classic: [0, 0], playful: [6, 10], corporate: [0, 3],
};

/**
 * The magazine page, invented for this deck.
 *
 * Flat ground — paper or ink — and one colour field strong enough to carry a
 * cover. Ink is checked against the ground, against a card's tint and against
 * the panel; the ink set on the colour field is checked against the field. No
 * light, so nothing to read through: contrast is the whole job.
 */
function editorialDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0x5eed);
  const dark = direction.mode === "dark";
  const vivid = direction.energy === "vivid";
  const hue = turn(direction.hue, Math.round((next() - 0.5) * 12));
  const offsets = HARMONY[direction.mood].map((offset) => offset + Math.round((next() - 0.5) * 10));
  const hues = offsets.map((offset) => turn(hue, offset)) as [number, number, number, number];

  // Paper is warm or cool by a hair; ink is deep, never pure black.
  const ground = dark
    ? oklch(0.17 + next() * 0.025, 0.018 + next() * 0.014, hue)
    : oklch(0.968 - next() * 0.014, 0.008 + next() * 0.01, turn(hue, 18));
  const ground2 = ground;
  const panel = dark ? oklch(0.235, 0.022, hue) : oklch(0.925, 0.02, turn(hue, 12));
  const panelStrong = dark ? oklch(0.27, 0.028, hue) : oklch(0.9, 0.028, turn(hue, 8));
  const grounds = [ground, panel, panelStrong];

  const ink = legible({ l: dark ? 0.96 : 0.18, c: dark ? 0.01 : 0.03, h: hue, grounds, ratio: 7.5, dark });
  const inkSoft = legible({ l: dark ? 0.78 : 0.4, c: dark ? 0.02 : 0.035, h: hue, grounds, ratio: 4.8, dark });
  const accent = legible({ l: dark ? 0.78 : 0.5, c: vivid ? 0.19 : 0.15, h: hues[1], grounds, ratio: 4.6, dark });
  const accent2 = legible({ l: dark ? 0.74 : 0.46, c: vivid ? 0.16 : 0.12, h: hues[2], grounds, ratio: 3.4, dark });

  // The colour field: saturated, mid-dark on paper and bright on ink.
  const block = dark
    ? oklch(vivid ? 0.72 : 0.66, vivid ? 0.17 : 0.12, hues[1])
    : oklch(vivid ? 0.46 : 0.38, vivid ? 0.17 : 0.11, hues[0]);
  const onBlock = contrast("#FFFFFF", block) >= contrast(oklch(0.16, 0.02, hue), block) ? "#FFFFFF" : oklch(0.16, 0.02, hue);
  const onAccent = contrast("#FFFFFF", accent) >= contrast(ground, accent) ? "#FFFFFF" : ground;
  const line = alpha(ink, dark ? 0.22 : 0.18);

  // Charts in the field, the accent and two quiet neighbours.
  // The field's colour, the accent, a lighter step of the field and a neutral:
  // four bars that read as one family, each clear against the paper.
  const chart = [
    block,
    accent,
    oklch(dark ? 0.6 : 0.62, dark ? 0.1 : 0.1, hues[0]),
    oklch(dark ? 0.72 : 0.42, 0.02, hue),
  ] as DesignDNA["colors"]["chart"];

  const [low, high] = EDITORIAL_RADIUS[direction.mood];
  const looks: PanelLook[] = ["tint", "outline", "rule"];
  return {
    seed,
    direction: { ...direction, hue },
    style: "editorial",
    panelLook: looks[Math.floor(next() * looks.length)]!,
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(low + next() * (high - low)),
    colors: {
      ground,
      ground2,
      ink,
      inkSoft,
      accent,
      accent2,
      onAccent,
      glass: panel,
      glassStrong: panelStrong,
      sheen: panel,
      rim: line,
      shadow: dark ? "#000000" : oklch(0.3, 0.04, hue),
      glows: [block, accent, accent2, panel],
      chart,
      panel,
      panelStrong,
      line,
      block,
      onBlock,
    },
    fonts: pairFonts(direction, next, input.available),
    intensity: 0,
  };
}

/* ------------------------------------------------------------ soft 3d */

/**
 * The device, invented for this deck.
 *
 * One material in one colour: the ground, the cards and the wells are all the
 * same tone of the topic's hue, nearly grey, and depth comes from light and
 * shade alone (`glass/soft.ts`). One neon accent — the device's indicator
 * light — carries every number and mark. Ink is checked on the ground and in
 * the shade of a well; the face is always a geometric sans.
 */
function softDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0x3d3d);
  const dark = direction.mode === "dark";
  const vivid = direction.energy === "vivid";
  const hue = turn(direction.hue, Math.round((next() - 0.5) * 14));
  const offsets = HARMONY[direction.mood].map((offset) => offset + Math.round((next() - 0.5) * 12));
  const hues = offsets.map((offset) => turn(hue, offset)) as [number, number, number, number];

  // The material: a near-grey of the topic's hue.
  const ground = dark ? oklch(0.255 + next() * 0.02, 0.016, hue) : oklch(0.928 - next() * 0.012, 0.011, hue);
  const lit = dark ? oklch(0.3, 0.018, hue) : oklch(0.958, 0.008, hue);
  const sheen = dark ? oklch(0.36, 0.02, hue) : "#FFFFFF";
  const shade = dark ? oklch(0.13, 0.015, hue) : oklch(0.7, 0.03, hue);
  // Ink must also read where a well's shade falls on the ground.
  const shaded = over(alpha(shade, dark ? 0.5 : 0.3), ground);
  const grounds = [ground, lit, shaded];

  const ink = legible({ l: dark ? 0.95 : 0.22, c: dark ? 0.01 : 0.025, h: hue, grounds, ratio: 7, dark });
  const inkSoft = legible({ l: dark ? 0.78 : 0.42, c: dark ? 0.015 : 0.03, h: hue, grounds, ratio: 4.6, dark });
  // The indicator light: the one saturated colour in the room.
  const accent = legible({ l: dark ? 0.82 : 0.54, c: vivid ? 0.2 : 0.16, h: hues[1], grounds, ratio: 4.6, dark });
  const accent2 = legible({ l: dark ? 0.78 : 0.5, c: vivid ? 0.17 : 0.13, h: hues[2], grounds: [ground, lit], ratio: 3.2, dark });

  const chart = [
    accent,
    accent2,
    oklch(dark ? 0.62 : 0.66, 0.06, hue),
    oklch(dark ? 0.48 : 0.8, 0.02, hue),
  ] as DesignDNA["colors"]["chart"];

  return {
    seed,
    direction: { ...direction, hue },
    style: "soft3d",
    panelLook: "tint",
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(18 + next() * 10),
    colors: {
      ground,
      ground2: ground,
      ink,
      inkSoft,
      accent,
      accent2,
      // A tag on this device is a raised button with its number lit.
      onAccent: accent,
      glass: ground,
      glassStrong: ground,
      sheen,
      rim: alpha(sheen, 0.6),
      shadow: shade,
      glows: [accent, accent2, sheen, shade],
      chart,
      panel: lit,
      panelStrong: lit,
      line: alpha(ink, dark ? 0.16 : 0.12),
      block: accent,
      onBlock: dark ? oklch(0.18, 0.02, hue) : "#FFFFFF",
    },
    // Futuristic is geometric: a sans display whatever the topic's voice.
    fonts: pairFonts({ ...direction, typography: "sans" }, next, input.available),
    intensity: 0,
  };
}

/* ---------------------------------------------------------- corporate */

/**
 * The business template, invented for this deck.
 *
 * Always on white. One brand colour carries the deck — dark enough that white
 * type reads on it, bright enough to read as the brand — graded into a second
 * step of its own hue for the large forms. Ink is checked on white and on the
 * faint grey of a strong card; the face is a geometric sans.
 */
function corporateDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0xb12a);
  const vivid = direction.energy === "vivid";
  const hue = turn(direction.hue, Math.round((next() - 0.5) * 10));
  const offsets = HARMONY[direction.mood].map((offset) => offset + Math.round((next() - 0.5) * 10));
  const hues = offsets.map((offset) => turn(hue, offset)) as [number, number, number, number];

  const ground = "#FFFFFF";
  const panel = "#FFFFFF";
  const panelStrong = oklch(0.975, 0.008, hue);
  const grounds = [ground, panelStrong];
  const ink = legible({ l: 0.22, c: 0.02, h: hue, grounds, ratio: 8, dark: false });
  const inkSoft = legible({ l: 0.48, c: 0.02, h: hue, grounds, ratio: 4.8, dark: false });

  // The brand: walked darker until white type reads on it, so one colour can
  // be both the forms behind the page and the cards set in white on it.
  const brand = legible({ l: vivid ? 0.62 : 0.58, c: vivid ? 0.18 : 0.15, h: hue, grounds: [ground], ratio: 4.6, dark: false });
  const brand2 = legible({ l: vivid ? 0.56 : 0.52, c: vivid ? 0.17 : 0.14, h: turn(hue, 16), grounds: [ground], ratio: 5, dark: false });
  const second = legible({ l: 0.56, c: 0.15, h: hues[2], grounds, ratio: 4.5, dark: false });

  return {
    seed,
    direction: { ...direction, mode: "light", hue },
    style: "corporate",
    panelLook: "tint",
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(18 + next() * 8),
    colors: {
      ground,
      ground2: ground,
      ink,
      inkSoft,
      accent: brand,
      accent2: second,
      onAccent: "#FFFFFF",
      glass: panel,
      glassStrong: panelStrong,
      sheen: "#FFFFFF",
      rim: alpha(ink, 0.06),
      shadow: oklch(0.32, 0.05, hue),
      glows: [brand, brand2, oklch(0.93, 0.05, hue), panelStrong],
      chart: [brand, oklch(0.75, 0.12, hue), second, oklch(0.62, 0.02, hue)],
      panel,
      panelStrong,
      line: alpha(ink, 0.1),
      block: brand,
      onBlock: "#FFFFFF",
    },
    fonts: pairFonts({ ...direction, typography: "sans" }, next, input.available),
    intensity: 0,
  };
}

/* ------------------------------------------------------------- naqsh */

/**
 * A national-ornament deck: always a light page, its colours taken from the
 * family its ornaments were baked in (`naqsh-palette.ts`), so the page and the
 * pictures on it are one palette. The family is the one nearest the deck's
 * hue — exactly the chosen one when the author picked a colour.
 */
function naqshDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0x5a9c);
  const family = nearestFamily(direction.hue);
  const { deep, bright, hue } = NAQSH_FAMILIES[family];

  const ground = "#FFFDF9";
  const panel = "#FFFFFF";
  const panelStrong = hex(toWhite(deep, 0.94));
  const grounds = [ground, panel, panelStrong];
  const ink = legible({ l: 0.22, c: 0.03, h: hue, grounds, ratio: 9, dark: false });
  const inkSoft = legible({ l: 0.46, c: 0.025, h: hue, grounds, ratio: 5, dark: false });
  const accent = hex(deep);
  const accent2 = hex(bright);

  return {
    seed,
    direction: { ...direction, mode: "light", hue },
    style: "naqsh",
    panelLook: "tint",
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(14 + next() * 6),
    colors: {
      ground,
      ground2: ground,
      ink,
      inkSoft,
      accent,
      accent2,
      onAccent: "#FFFFFF",
      glass: panel,
      glassStrong: panelStrong,
      sheen: "#FFFFFF",
      rim: alpha(accent, 0.16),
      shadow: oklch(0.3, 0.05, hue),
      glows: [accent, accent2, hex(toWhite(deep, 0.82)), panelStrong],
      chart: [accent, accent2, hex(toWhite(deep, 0.45)), oklch(0.68, 0.02, hue)],
      panel,
      panelStrong,
      line: alpha(ink, 0.1),
      block: accent,
      onBlock: "#FFFFFF",
    },
    fonts: pairFonts({ ...direction, typography: "mixed" }, next, input.available),
    intensity: 0,
    ornament: family,
  };
}

/* ------------------------------------------------------------- spektr */

/**
 * A Spektr deck: white pages with a spectrum and vivid hero fields, from the
 * family table in `spektr.ts`. `accent` is the hero gradient's deep end — the
 * colour small words are set in, dark enough for them — while the bright
 * spectrum (`chart`) colours the figures, icons and cards, one each.
 */
function spektrDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0x3e17);
  const family = nearestFamily(direction.hue);
  const { hero, spectrum } = SPEKTR_FAMILIES[family];
  const hue = NAQSH_FAMILIES[family].hue;

  const ground = "#FFFFFF";
  const panel = "#FFFFFF";
  const panelStrong = "#F5F7FC";
  const grounds = [ground, panelStrong];
  const ink = legible({ l: 0.2, c: 0.03, h: 265, grounds, ratio: 10, dark: false });
  const inkSoft = legible({ l: 0.48, c: 0.02, h: 265, grounds, ratio: 5, dark: false });

  return {
    seed,
    direction: { ...direction, mode: "light", hue },
    style: "spektr",
    panelLook: "tint",
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(16 + next() * 6),
    colors: {
      ground,
      ground2: ground,
      ink,
      inkSoft,
      accent: hero[0],
      accent2: hero[1],
      onAccent: "#FFFFFF",
      glass: panel,
      glassStrong: panelStrong,
      sheen: "#FFFFFF",
      rim: alpha(ink, 0.07),
      shadow: oklch(0.3, 0.04, 265),
      glows: [hero[0], hero[1], hero[2], panelStrong],
      chart: [...spectrum],
      panel,
      panelStrong,
      line: alpha(ink, 0.08),
      block: hero[0],
      onBlock: "#FFFFFF",
    },
    fonts: pairFonts({ ...direction, typography: "sans" }, next, input.available),
    intensity: 0,
  };
}

/* ------------------------------------------------------------ mozaika */

/**
 * A mozaika deck: white pages in a deep navy ink, the family's field for its
 * hero pages, its mosaic colours and a spectrum of figure colours from the
 * table in `mozaika.ts`. Set in Poppins — the geometric sans the style is
 * drawn for — wherever the library has it.
 */
function mozaikaDNA(input: {
  direction: ArtDirection;
  seed: number;
  available: (family: string, weight: number) => boolean;
}): DesignDNA {
  const { direction, seed } = input;
  const next = random(seed ^ 0x6d07);
  const family = nearestFamily(direction.hue);
  const { hero, lead, tiles, heroTiles, spectrum } = MOZAIKA_FAMILIES[family];
  const hue = NAQSH_FAMILIES[family].hue;

  const ground = "#FFFFFF";
  const panel = "#FFFFFF";
  const panelStrong = "#F6F7FB";
  const grounds = [ground, panelStrong];
  const ink = legible({ l: 0.24, c: 0.08, h: 268, grounds, ratio: 10, dark: false });
  const inkSoft = legible({ l: 0.5, c: 0.03, h: 268, grounds, ratio: 5, dark: false });
  const geometric = ["Poppins"].every((name) => [400, 600, 700].every((weight) => input.available(name, weight)));
  const fonts: ThemeFonts = geometric
    ? {
      display: { family: "Poppins", weight: 700, em: 0.517 },
      title: { family: "Poppins", weight: 700, em: 0.517 },
      strong: { family: "Poppins", weight: 600, em: 0.509 },
      body: { family: "Poppins", weight: 400, em: 0.491 },
      label: { family: "Poppins", weight: 600, em: 0.509, tracking: 2.2 },
    }
    : pairFonts({ ...direction, typography: "sans", mood: "playful" }, next, input.available);

  return {
    seed,
    direction: { ...direction, mode: "light", hue },
    style: "mozaika",
    panelLook: "tint",
    motif: MOTIFS[Math.floor(next() * MOTIFS.length)]!,
    radius: Math.round(14 + next() * 6),
    colors: {
      ground,
      ground2: ground,
      ink,
      inkSoft,
      accent: lead,
      accent2: spectrum[1],
      onAccent: "#FFFFFF",
      glass: panel,
      glassStrong: panelStrong,
      sheen: "#FFFFFF",
      rim: alpha(ink, 0.07),
      shadow: oklch(0.3, 0.05, 268),
      glows: [hero, lead, spectrum[1], panelStrong],
      chart: [...spectrum],
      panel,
      panelStrong,
      line: alpha(ink, 0.08),
      block: hero,
      onBlock: "#FFFFFF",
    },
    fonts,
    intensity: 0,
    tiles: { page: [...tiles], hero: [...heroTiles] },
  };
}
