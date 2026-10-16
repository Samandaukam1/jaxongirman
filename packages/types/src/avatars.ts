/**
 * The O‘yingoh characters.
 *
 * Forty portraits, each a fixed recipe over one carefully drawn bust: skin
 * with light falling on it, eyes with an iris and a catch-light, brows, a nose,
 * a mouth that smiles, hair with a sheen, and clothes with a collar. The app
 * draws them with react-native-svg and the projector with inline SVG from this
 * same data, so a player is the identical character on both — neither renderer
 * decides anything.
 *
 * Indexes 0–19 read as girls and 20–39 as boys, which keeps every saved
 * player's id pointing at the same kind of character it always did. Between
 * them: five skin tones, a ro‘mol and a do‘ppi, glasses and beards, school
 * collars and an atlas chapan — a room of students and their teacher should
 * each find themselves in the grid.
 */

export const GAME_AVATAR_COUNT = 40;

/* ------------------------------------------------------------------ data */

export type GameAvatarStop = { offset: number; color: string; opacity?: number };

/** Gradients are in viewBox units (`userSpaceOnUse`), so 0–100 on both axes. */
export type GameAvatarDef =
  | { kind: "linear"; id: string; x1: number; y1: number; x2: number; y2: number; stops: GameAvatarStop[] }
  | { kind: "radial"; id: string; cx: number; cy: number; r: number; fx?: number; fy?: number; stops: GameAvatarStop[] }
  | { kind: "clip"; id: string; d: string };

type Paint = {
  /** A colour, or `url(#id)` naming one of the art's defs. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  /** The id of a clip def this shape is cut to. */
  clip?: string;
};

export type GameAvatarShape =
  | ({ kind: "circle"; cx: number; cy: number; r: number } & Paint)
  | ({ kind: "ellipse"; cx: number; cy: number; rx: number; ry: number } & Paint)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number; rx: number } & Paint)
  | ({ kind: "path"; d: string } & Paint);

/**
 * One portrait as a renderer needs it: the defs to declare, the clip the
 * whole picture is cut to (the round badge), and the shapes in paint order.
 */
export type GameAvatarArt = { defs: GameAvatarDef[]; frame: string; shapes: GameAvatarShape[] };

/* ---------------------------------------------------------------- recipes */

export type GameAvatarHair =
  | "long" | "wavy" | "bob" | "ponytail" | "bun" | "braids" | "curly" | "puff" | "headscarf"
  | "short" | "quiff" | "fade" | "crew" | "afro" | "sideswept" | "curlyShort" | "cap";

export type GameAvatarOutfit = "tee" | "hoodie" | "collar" | "sweater" | "vneck" | "jacket" | "chapan";
export type GameAvatarMouth = "smile" | "grin" | "soft" | "happy";
export type GameAvatarAccessory =
  | "none" | "glasses" | "roundGlasses" | "headband" | "earrings" | "freckles"
  | "doppi" | "gulliDoppi" | "beard" | "mustache";

export interface GameAvatarSpec {
  /** Index into the skin tones, lightest first. */
  skin: number;
  hair: string;
  style: GameAvatarHair;
  eyes: string;
  mouth: GameAvatarMouth;
  outfit: GameAvatarOutfit;
  shirt: string;
  /** A second colour the outfit uses: a tie, a scarf's pattern, a chapan's stripe. */
  trim: string;
  bg: readonly [string, string];
  accessories: readonly GameAvatarAccessory[];
}

type Skin = { light: string; base: string; shade: string; deep: string };

const SKINS: readonly Skin[] = [
  { light: "#FFEBDD", base: "#FAD3B6", shade: "#EAB290", deep: "#D2906C" },
  { light: "#FCDDC4", base: "#F2BE98", shade: "#DD9C73", deep: "#C27E57" },
  { light: "#F2C7A0", base: "#DFA373", shade: "#C48356", deep: "#A6663E" },
  { light: "#DCA676", base: "#C18556", shade: "#A1673B", deep: "#83502A" },
  { light: "#B98455", base: "#99653C", shade: "#7C4D2A", deep: "#5F381C" },
];

const BG = {
  lavender: ["#F5EFFF", "#D3BFFB"],
  mint: ["#EAFBF4", "#ABE6CF"],
  peach: ["#FFF3EA", "#FFC9A8"],
  sky: ["#EDF6FF", "#B3D3FB"],
  lilac: ["#FAF0FF", "#DEC1F2"],
  aqua: ["#E9FBFD", "#A6E1EA"],
  cream: ["#FFF9E8", "#F8DC98"],
  rose: ["#FFF0F4", "#FBBDCD"],
  ice: ["#F1F4FB", "#C3CEE6"],
  sun: ["#FFF5E2", "#F4C17E"],
} as const;

const HAIR = {
  black: "#1E1A22",
  espresso: "#33221A",
  brown: "#5B3A22",
  chestnut: "#7A4A27",
  auburn: "#9A4524",
  copper: "#B9652E",
  blonde: "#D8A852",
  ash: "#B9A27E",
  lavender: "#9C83D8",
};

const EYES = {
  dark: "#2E1D14",
  brown: "#5C381B",
  hazel: "#7B5C27",
  green: "#3C7A4E",
  blue: "#3A6DB4",
  gray: "#5A6C7E",
};

const g = (
  skin: number, hair: string, style: GameAvatarHair, eyes: string, mouth: GameAvatarMouth,
  outfit: GameAvatarOutfit, shirt: string, trim: string, bg: readonly [string, string],
  ...accessories: GameAvatarAccessory[]
): GameAvatarSpec => ({ skin, hair, style, eyes, mouth, outfit, shirt, trim, bg, accessories });

export const GAME_AVATARS: readonly GameAvatarSpec[] = [
  // 0–19: qizlar
  g(1, HAIR.espresso, "long", EYES.brown, "smile", "tee", "#7C5CF0", "#FFFFFF", BG.lavender),
  g(1, HAIR.black, "bob", EYES.dark, "soft", "collar", "#FFFFFF", "#E0485F", BG.mint, "earrings"),
  g(3, HAIR.black, "braids", EYES.dark, "smile", "sweater", "#F06292", "#FFFFFF", BG.peach),
  g(0, HAIR.copper, "ponytail", EYES.green, "happy", "hoodie", "#3D7BEA", "#FFFFFF", BG.sky, "freckles"),
  g(2, HAIR.black, "headscarf", EYES.brown, "soft", "tee", "#5B3FB8", "#B79BFF", BG.lilac),
  g(2, HAIR.brown, "curly", EYES.hazel, "smile", "tee", "#13A3A0", "#FFFFFF", BG.aqua, "roundGlasses"),
  g(4, HAIR.black, "puff", EYES.dark, "grin", "sweater", "#F2B23A", "#FFFFFF", BG.cream, "headband"),
  g(0, HAIR.blonde, "wavy", EYES.blue, "smile", "jacket", "#F0727A", "#FFFFFF", BG.rose),
  g(1, HAIR.chestnut, "bun", EYES.brown, "soft", "jacket", "#2F4A8A", "#FFFFFF", BG.ice, "glasses", "earrings"),
  g(2, HAIR.black, "braids", EYES.dark, "happy", "chapan", "#D9344F", "#2E7BD6", BG.sun, "gulliDoppi"),
  g(1, HAIR.brown, "long", EYES.hazel, "happy", "hoodie", "#B48CF2", "#FFFFFF", BG.lavender, "headband"),
  g(3, HAIR.black, "headscarf", EYES.dark, "smile", "tee", "#119C7A", "#7FE0C2", BG.mint),
  g(0, HAIR.chestnut, "bob", EYES.gray, "happy", "sweater", "#E5A72F", "#FFFFFF", BG.cream, "roundGlasses"),
  g(2, HAIR.black, "ponytail", EYES.dark, "grin", "tee", "#E5484D", "#FFFFFF", BG.rose, "earrings"),
  g(4, HAIR.black, "curly", EYES.dark, "soft", "jacket", "#1F8F64", "#FFFFFF", BG.mint, "earrings"),
  g(0, HAIR.auburn, "long", EYES.green, "smile", "vneck", "#159A9C", "#FFFFFF", BG.aqua, "freckles"),
  g(3, HAIR.espresso, "wavy", EYES.brown, "happy", "collar", "#DCE8FF", "#2C5BD4", BG.sky),
  g(1, HAIR.lavender, "bun", EYES.brown, "smile", "tee", "#F27CB0", "#FFFFFF", BG.lilac, "earrings"),
  g(3, HAIR.black, "long", EYES.dark, "soft", "chapan", "#7A3FD0", "#F2B23A", BG.peach, "earrings"),
  g(0, HAIR.blonde, "braids", EYES.blue, "grin", "hoodie", "#34B58A", "#FFFFFF", BG.mint),
  // 20–39: o‘g‘illar
  g(1, HAIR.espresso, "short", EYES.brown, "smile", "tee", "#3D7BEA", "#FFFFFF", BG.sky),
  g(2, HAIR.black, "quiff", EYES.dark, "grin", "hoodie", "#21A06B", "#FFFFFF", BG.mint),
  g(3, HAIR.black, "fade", EYES.dark, "happy", "sweater", "#7C5CF0", "#FFFFFF", BG.lavender, "glasses"),
  g(4, HAIR.black, "afro", EYES.dark, "smile", "tee", "#F28C28", "#FFFFFF", BG.cream),
  g(0, HAIR.copper, "crew", EYES.green, "grin", "hoodie", "#E5484D", "#FFFFFF", BG.rose, "freckles"),
  g(1, HAIR.brown, "sideswept", EYES.hazel, "happy", "collar", "#FFFFFF", "#24408E", BG.ice),
  g(2, HAIR.black, "short", EYES.dark, "smile", "chapan", "#2F55C9", "#E5484D", BG.sun, "doppi"),
  g(1, HAIR.espresso, "cap", EYES.brown, "grin", "tee", "#F2F4F8", "#2F6FE0", BG.sky),
  g(1, HAIR.black, "crew", EYES.brown, "happy", "jacket", "#59606E", "#FFFFFF", BG.ice, "roundGlasses", "beard"),
  g(3, HAIR.black, "fade", EYES.dark, "grin", "hoodie", "#F2B23A", "#FFFFFF", BG.cream),
  g(2, HAIR.espresso, "quiff", EYES.brown, "happy", "tee", "#EF6FA0", "#FFFFFF", BG.rose),
  g(2, HAIR.brown, "sideswept", EYES.hazel, "smile", "sweater", "#1A9E9A", "#FFFFFF", BG.aqua, "glasses"),
  g(4, HAIR.black, "crew", EYES.dark, "smile", "jacket", "#22325E", "#FFFFFF", BG.lilac, "beard"),
  g(0, HAIR.chestnut, "cap", EYES.blue, "smile", "hoodie", "#E9603A", "#E5484D", BG.peach),
  g(1, HAIR.brown, "short", EYES.green, "happy", "vneck", "#2E9E5B", "#FFFFFF", BG.mint, "freckles"),
  g(3, HAIR.black, "short", EYES.dark, "smile", "chapan", "#1D7F6E", "#F2B23A", BG.sun, "doppi", "mustache"),
  g(2, HAIR.black, "curlyShort", EYES.dark, "smile", "tee", "#8A5CF0", "#FFFFFF", BG.lavender),
  g(0, HAIR.ash, "sideswept", EYES.blue, "smile", "sweater", "#3567D8", "#FFFFFF", BG.sky, "roundGlasses"),
  g(3, HAIR.black, "quiff", EYES.dark, "grin", "jacket", "#5F7A3A", "#FFFFFF", BG.cream),
  g(1, HAIR.brown, "cap", EYES.hazel, "happy", "tee", "#FFFFFF", "#18A06A", BG.mint),
];

/** A safe lookup: any out-of-range id lands on the first character, never crashes. */
export function gameAvatar(id: number): GameAvatarSpec {
  return GAME_AVATARS[Number.isInteger(id) && id >= 0 && id < GAME_AVATARS.length ? id : 0]!;
}

/**
 * Quick picks for the join screen: a few ways into the grid, never a question
 * anyone has to answer — "Hammasi" is always there and is where it opens.
 */
export type GameAvatarGroup = "all" | "girls" | "boys" | "national" | "glasses";

export const GAME_AVATAR_GROUPS: readonly { key: GameAvatarGroup; label: string }[] = [
  { key: "all", label: "Hammasi" },
  { key: "girls", label: "Qizlar" },
  { key: "boys", label: "O‘g‘illar" },
  { key: "national", label: "Milliy" },
  { key: "glasses", label: "Ko‘zoynakli" },
];

export function gameAvatarIds(group: GameAvatarGroup): number[] {
  const ids = GAME_AVATARS.map((_, id) => id);
  switch (group) {
    case "girls": return ids.filter((id) => id < 20);
    case "boys": return ids.filter((id) => id >= 20);
    case "national": return ids.filter((id) => {
      const spec = GAME_AVATARS[id]!;
      return spec.style === "headscarf" || spec.outfit === "chapan" || spec.accessories.includes("doppi") || spec.accessories.includes("gulliDoppi");
    });
    case "glasses": return ids.filter((id) => {
      const spec = GAME_AVATARS[id]!;
      return spec.accessories.includes("glasses") || spec.accessories.includes("roundGlasses");
    });
    default: return ids;
  }
}

/* ----------------------------------------------------------------- colour */

function channel(hex: string, at: number): number {
  return parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
}

/** `a` moved toward `b` by `t`. */
function mix(a: string, b: string, t: number): string {
  const out = [0, 1, 2].map((at) => Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * t));
  return `#${out.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const darker = (hex: string, t: number) => mix(hex, "#120C18", t);
const lighter = (hex: string, t: number) => mix(hex, "#FFFFFF", t);

function luminance(hex: string): number {
  return (0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)) / 255;
}

/* --------------------------------------------------------------- geometry */

const CIRCLE = "M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z";
const HEAD = "M50 21.5 C61.6 21.5 68.8 30.2 68.8 42.6 C68.8 56.4 60.2 67.2 50 67.2 C39.8 67.2 31.2 56.4 31.2 42.6 C31.2 30.2 38.4 21.5 50 21.5 Z";
const BODY = "M10 106 C10 88 21.5 79.2 36.5 76.4 C40.6 79.6 45 81.2 50 81.2 C55 81.2 59.4 79.6 63.5 76.4 C78.5 79.2 90 88 90 106 Z";
const NECKLINE = "M36.5 76.4 C40.6 79.6 45 81.2 50 81.2 C55 81.2 59.4 79.6 63.5 76.4";

const EYE_Y = 46.2;
const EYE_X = [42.4, 57.6] as const;

/* ---------------------------------------------------------------- drawing */

/** Paints one portrait, as defs and shapes in paint order. */
export function gameAvatarArt(id: number): GameAvatarArt {
  const index = Number.isInteger(id) && id >= 0 && id < GAME_AVATARS.length ? id : 0;
  const spec = GAME_AVATARS[index]!;
  const skin = SKINS[spec.skin] ?? SKINS[0]!;
  const girl = index < 20;
  const has = (accessory: GameAvatarAccessory) => spec.accessories.includes(accessory);
  const key = (name: string) => `ga${index}-${name}`;
  const url = (name: string) => `url(#${key(name)})`;

  // Black hair catches a warm brown light, not a grey one.
  const hairLight = luminance(spec.hair) < 0.18 ? mix(spec.hair, "#6B4A3C", 0.5) : lighter(spec.hair, luminance(spec.hair) > 0.45 ? 0.35 : 0.22);
  const hairDark = darker(spec.hair, 0.35);
  const shirtLight = lighter(spec.shirt, 0.18);
  const shirtShade = darker(spec.shirt, luminance(spec.shirt) > 0.85 ? 0.12 : 0.22);
  const ink = "#24171E";
  const lip = mix(skin.deep, "#C83C5A", 0.55);

  const defs: GameAvatarDef[] = [
    { kind: "clip", id: key("frame"), d: CIRCLE },
    { kind: "clip", id: key("body"), d: BODY },
    { kind: "radial", id: key("bg"), cx: 34, cy: 26, r: 82, stops: [{ offset: 0, color: spec.bg[0] }, { offset: 1, color: spec.bg[1] }] },
    {
      kind: "radial", id: key("skin"), cx: 43, cy: 36, r: 36, fx: 41, fy: 32,
      stops: [{ offset: 0, color: skin.light }, { offset: 0.55, color: skin.base }, { offset: 1, color: skin.shade }],
    },
    { kind: "linear", id: key("neck"), x1: 50, y1: 58, x2: 50, y2: 82, stops: [{ offset: 0, color: skin.deep }, { offset: 0.5, color: skin.shade }] },
    { kind: "linear", id: key("hair"), x1: 34, y1: 16, x2: 66, y2: 84, stops: [{ offset: 0, color: hairLight }, { offset: 0.45, color: spec.hair }, { offset: 1, color: hairDark }] },
    { kind: "linear", id: key("shirt"), x1: 30, y1: 74, x2: 70, y2: 104, stops: [{ offset: 0, color: shirtLight }, { offset: 1, color: shirtShade }] },
  ];
  // One iris gradient per eye, each centred on its own eye.
  for (const [at, x] of EYE_X.entries()) {
    defs.push({
      kind: "radial", id: key(`iris${at}`), cx: x, cy: EYE_Y + 0.6, r: 2.8, fx: x - 0.4, fy: EYE_Y + 1.4,
      stops: [{ offset: 0, color: lighter(spec.eyes, 0.42) }, { offset: 0.7, color: spec.eyes }, { offset: 1, color: darker(spec.eyes, 0.35) }],
    });
  }

  const frame = key("frame");
  const shapes: GameAvatarShape[] = [];
  const add = (shape: GameAvatarShape) => { shapes.push(shape); };

  /* backdrop: a lit disc and a soft window of light in it */
  add({ kind: "circle", cx: 50, cy: 50, r: 50, fill: url("bg") });
  add({ kind: "ellipse", cx: 30, cy: 20, rx: 24, ry: 14, fill: "#FFFFFF", opacity: 0.32 });
  add({ kind: "circle", cx: 82, cy: 70, r: 3, fill: "#FFFFFF", opacity: 0.5 });
  add({ kind: "circle", cx: 17, cy: 64, r: 1.8, fill: "#FFFFFF", opacity: 0.55 });

  backHair(spec, add, url("hair"), hairDark);

  /* neck and shoulders */
  add({ kind: "path", d: "M43 56 L43 77.5 Q50 83 57 77.5 L57 56 Z", fill: url("neck") });
  add({ kind: "path", d: "M43 62.5 Q50 69.5 57 62.5 L57 67 Q50 73 43 67 Z", fill: skin.deep, opacity: 0.35 });
  outfit(spec, add, url("shirt"), shirtShade, shirtLight, key("body"));

  /* ears */
  for (const x of [31.4, 68.6]) {
    add({ kind: "ellipse", cx: x, cy: 46.5, rx: 3.8, ry: 5.2, fill: skin.base });
    add({ kind: "path", d: x < 50 ? "M32.4 43.6 C30.2 44.6 30 48.4 32.2 49.6" : "M67.6 43.6 C69.8 44.6 70 48.4 67.8 49.6", stroke: skin.deep, strokeWidth: 1, opacity: 0.55 });
  }
  if (has("earrings")) {
    for (const x of [31.2, 68.8]) {
      add({ kind: "circle", cx: x, cy: 52.6, r: 1.7, fill: "#F2C14E" });
      add({ kind: "circle", cx: x - 0.5, cy: 52.1, r: 0.55, fill: "#FFF6D8" });
    }
  }

  /* head */
  add({ kind: "path", d: HEAD, fill: url("skin") });
  // Light from the upper left: a soft shadow along the right cheek and jaw.
  add({ kind: "path", d: "M62 30 C67 35 69.2 43 68 51 C66.6 59.6 60.4 66 52.6 67 C59 62 63.6 54 64 45 C64.3 39 63.6 34 62 30 Z", fill: skin.shade, opacity: 0.32 });

  face(spec, add, skin, ink, lip, url, girl, has);

  frontHair(spec, add, url("hair"), hairLight, hairDark);

  /* accessories worn over hair */
  if (has("headband")) {
    add({ kind: "path", d: "M31.6 37.2 C35 27.6 42 23.4 50 23.4 C58 23.4 65 27.6 68.4 37.2 L66.2 38.4 C63.2 30.6 57.2 26.6 50 26.6 C42.8 26.6 36.8 30.6 33.8 38.4 Z", fill: spec.shirt === "#FFFFFF" ? spec.trim : lighter(spec.shirt, 0.08) });
    add({ kind: "path", d: "M36 31 C40 27 45 25.4 50 25.4", stroke: "#FFFFFF", strokeWidth: 0.9, opacity: 0.55 });
  }
  if (has("doppi") || has("gulliDoppi")) doppi(add, has("gulliDoppi"), spec.trim);
  if (has("glasses") || has("roundGlasses")) glasses(add, has("roundGlasses"));

  return { defs, frame, shapes };
}

/* ------------------------------------------------------------------ face */

function face(
  spec: GameAvatarSpec, add: (shape: GameAvatarShape) => void, skin: Skin, ink: string, lip: string,
  url: (name: string) => string, girl: boolean, has: (accessory: GameAvatarAccessory) => boolean,
) {
  const brow = luminance(spec.hair) > 0.45 ? darker(spec.hair, 0.45) : darker(spec.hair, 0.1);
  const dark = luminance(skin.base) < 0.45;

  // Cheeks.
  for (const x of [39.6, 60.4]) add({ kind: "ellipse", cx: x, cy: 54.2, rx: 4, ry: 2.4, fill: "#FF6F86", opacity: dark ? 0.2 : 0.26 });

  if (has("freckles")) {
    for (const [x, y] of [[38, 51.2], [40.6, 52.4], [42.6, 51], [57.4, 51], [59.4, 52.4], [62, 51.2]] as const) {
      add({ kind: "circle", cx: x, cy: y, r: 0.55, fill: skin.deep, opacity: 0.75 });
    }
  }

  // Eyes: white, iris, pupil, two catch-lights, and the lid line that frames them.
  for (const [at, x] of EYE_X.entries()) {
    add({ kind: "ellipse", cx: x, cy: EYE_Y + 0.4, rx: 3.5, ry: 3.9, fill: "#FFFFFF" });
    add({ kind: "circle", cx: x, cy: EYE_Y + 0.9, r: 2.75, fill: url(`iris${at}`) });
    add({ kind: "circle", cx: x, cy: EYE_Y + 1, r: 1.35, fill: "#120A10" });
    add({ kind: "circle", cx: x + 1, cy: EYE_Y - 0.2, r: 1, fill: "#FFFFFF" });
    add({ kind: "circle", cx: x - 0.9, cy: EYE_Y + 2, r: 0.45, fill: "#FFFFFF", opacity: 0.85 });
    add({ kind: "path", d: `M${x - 3.9} ${EYE_Y + 0.6} Q${x} ${EYE_Y - 4.6} ${x + 3.9} ${EYE_Y + 0.6}`, stroke: ink, strokeWidth: girl ? 1.55 : 1.2 });
    if (girl) {
      const outer = at === 0 ? -1 : 1;
      add({ kind: "path", d: `M${x + outer * 3.4} ${EYE_Y - 0.4} q${outer * 1.3} -0.3 ${outer * 2} -1.9`, stroke: ink, strokeWidth: 1.25 });
    }
  }

  // Brows, a touch heavier on the boys.
  add({ kind: "path", d: "M38.2 40.4 Q42.2 37.6 46.4 39.2", stroke: brow, strokeWidth: girl ? 1.45 : 2 });
  add({ kind: "path", d: "M53.6 39.2 Q57.8 37.6 61.8 40.4", stroke: brow, strokeWidth: girl ? 1.45 : 2 });

  // Nose: a shadow on one side and a light on the tip.
  add({ kind: "path", d: "M48.4 52.6 Q50 54.2 51.6 52.6", stroke: skin.deep, strokeWidth: 1.1, opacity: 0.75 });
  add({ kind: "path", d: "M51.2 47.4 Q52.2 50.4 51.4 52", stroke: skin.deep, strokeWidth: 0.9, opacity: 0.35 });
  add({ kind: "ellipse", cx: 49.6, cy: 51, rx: 0.9, ry: 0.65, fill: "#FFFFFF", opacity: 0.35 });

  if (has("beard")) {
    add({ kind: "path", d: "M33.4 50 C33.6 60.6 41 68.6 50 68.6 C59 68.6 66.4 60.6 66.6 50 C65 55.4 62 57.6 58.4 58 C55.6 56.4 53 55.8 50 55.8 C47 55.8 44.4 56.4 41.6 58 C38 57.6 35 55.4 33.4 50 Z", fill: url("hair"), opacity: 0.94 });
  }
  if (has("beard") || has("mustache")) {
    add({ kind: "path", d: "M44.4 56.8 C45.8 55 48.2 54.6 50 55.6 C51.8 54.6 54.2 55 55.6 56.8 C54.2 56.4 52 56.5 50 56.9 C48 56.5 45.8 56.4 44.4 56.8 Z", fill: url("hair") });
  }

  mouth(spec.mouth, add, ink, lip, girl);
}

function mouth(kind: GameAvatarMouth, add: (shape: GameAvatarShape) => void, ink: string, lip: string, girl: boolean) {
  const inside = "#6E1F33";
  switch (kind) {
    case "smile":
      add({ kind: "path", d: "M44.4 57.6 Q50 64.6 55.6 57.6 Q50 59.2 44.4 57.6 Z", fill: inside });
      add({ kind: "path", d: "M45.6 58.1 Q50 59.4 54.4 58.1 L54 59.3 Q50 60.3 46 59.3 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M47.4 62.2 Q50 60.5 52.6 62.2 Q50 63.5 47.4 62.2 Z", fill: "#F07386" });
      add({ kind: "path", d: "M44.4 57.6 Q50 64.6 55.6 57.6", stroke: girl ? lip : ink, strokeWidth: 0.9, opacity: 0.7 });
      return;
    case "grin":
      add({ kind: "path", d: "M42.8 56.8 Q50 66.6 57.2 56.8 Q50 58.6 42.8 56.8 Z", fill: inside });
      add({ kind: "path", d: "M44.2 57.4 Q50 59 55.8 57.4 L55.2 59 Q50 60.4 44.8 59 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M46.4 62.6 Q50 60.4 53.6 62.6 Q50 64.6 46.4 62.6 Z", fill: "#F07386" });
      add({ kind: "path", d: "M41.6 56.4 Q42.4 57.2 43 56.6 M58.4 56.4 Q57.6 57.2 57 56.6", stroke: ink, strokeWidth: 0.8, opacity: 0.55 });
      return;
    case "soft":
      add({ kind: "path", d: "M44.8 58 Q47.4 56.2 50 57.2 Q52.6 56.2 55.2 58 Q52.6 61.8 50 61.8 Q47.4 61.8 44.8 58 Z", fill: lip });
      add({ kind: "path", d: "M44.8 58 Q50 59.8 55.2 58", stroke: darker(lip, 0.4), strokeWidth: 0.9 });
      add({ kind: "ellipse", cx: 51.2, cy: 60.2, rx: 1.4, ry: 0.55, fill: "#FFFFFF", opacity: 0.38 });
      return;
    case "happy":
      add({ kind: "path", d: "M45 57.6 Q50 62.6 55 57.6", stroke: girl ? darker(lip, 0.2) : ink, strokeWidth: 1.5 });
      add({ kind: "path", d: "M44.2 57 Q44.6 57.9 45.4 57.8 M55.8 57 Q55.4 57.9 54.6 57.8", stroke: ink, strokeWidth: 0.8, opacity: 0.5 });
      return;
  }
}

/* ------------------------------------------------------------------ hair */

function backHair(spec: GameAvatarSpec, add: (shape: GameAvatarShape) => void, fill: string, dark: string) {
  switch (spec.style) {
    case "long":
      add({ kind: "path", d: "M28.4 42 C27.6 25.6 37.6 16.8 50 16.8 C62.4 16.8 72.4 25.6 71.6 42 L72.6 72 C73 78.6 69.6 82.4 63.6 82.4 L36.4 82.4 C30.4 82.4 27 78.6 27.4 72 Z", fill });
      add({ kind: "path", d: "M40 60 L40 82 M60 60 L60 82", stroke: dark, strokeWidth: 0.8, opacity: 0.35 });
      return;
    case "wavy":
      add({ kind: "path", d: "M28.4 42 C27.6 25.6 37.6 16.8 50 16.8 C62.4 16.8 72.4 25.6 71.6 42 C71.4 48 74.8 52 72.4 57 C70.4 61.6 75 65.6 73.2 71 C71.4 76.6 74 80.6 68.6 83 L31.4 83 C26 80.6 28.6 76.6 26.8 71 C25 65.6 29.6 61.6 27.6 57 C25.2 52 28.6 48 28.4 42 Z", fill });
      return;
    case "bob":
      add({ kind: "path", d: "M28 43 C27.2 26.2 37.6 17.6 50 17.6 C62.4 17.6 72.8 26.2 72 43 L72.8 60 C73 64.2 70.4 66 67.2 65 C61 63.4 39 63.4 32.8 65 C29.6 66 27 64.2 27.2 60 Z", fill });
      return;
    case "ponytail":
      add({ kind: "path", d: "M64 28 C74.6 26.4 80.6 34.6 79.6 46 C78.8 55 74 62.4 69.4 68.4 C71.6 60 72.2 52 70 44.6 C68.8 40 66.8 36 64 33 Z", fill });
      add({ kind: "path", d: "M72 36 C75 42 75.4 50 73 58", stroke: "#FFFFFF", strokeWidth: 0.9, opacity: 0.22 });
      return;
    case "curly":
      for (const [cx, cy, r] of [[29, 50, 7.6], [27.6, 60, 7], [31, 69, 6.8], [71, 50, 7.6], [72.4, 60, 7], [69, 69, 6.8], [30, 38, 8.4], [70, 38, 8.4]] as const) {
        add({ kind: "circle", cx, cy, r, fill });
      }
      return;
    case "afro":
      for (const [cx, cy, r] of [[50, 30, 21], [33, 32, 13], [67, 32, 13], [29, 44, 11], [71, 44, 11], [40, 19, 12], [60, 19, 12]] as const) {
        add({ kind: "circle", cx, cy, r, fill });
      }
      return;
    case "puff":
      // A cloud of coils: one round mass with its edge broken into curls.
      add({ kind: "circle", cx: 50, cy: 16, r: 12, fill });
      for (let at = 0; at < 12; at += 1) {
        const turn = (at / 12) * Math.PI * 2;
        add({ kind: "circle", cx: 50 + Math.cos(turn) * 11.6, cy: 16 + Math.sin(turn) * 11.6, r: 3.4, fill });
      }
      for (const [cx, cy] of [[44.6, 10.6], [50, 8.4], [55.4, 10.6], [42, 15.4]] as const) add({ kind: "circle", cx, cy, r: 2.2, fill: "#FFFFFF", opacity: 0.1 });
      return;
    case "bun":
      add({ kind: "circle", cx: 50, cy: 16.4, r: 9.4, fill });
      add({ kind: "path", d: "M44 13 C46.6 10 52 9.6 55 12.6", stroke: "#FFFFFF", strokeWidth: 1, opacity: 0.25 });
      return;
    case "headscarf":
      // The back of the scarf, falling to the shoulders.
      add({ kind: "path", d: "M26.6 46 C25.4 26 36.4 15.6 50 15.6 C63.6 15.6 74.6 26 73.4 46 C73 58 74.6 68 79 80 L21 80 C25.4 68 27 58 26.6 46 Z", fill: spec.shirt });
      return;
    default:
      return;
  }
}

function frontHair(spec: GameAvatarSpec, add: (shape: GameAvatarShape) => void, fill: string, light: string, dark: string) {
  const sheen = (d: string) => add({ kind: "path", d, stroke: "#FFFFFF", strokeWidth: 2.2, opacity: 0.17 });
  switch (spec.style) {
    case "long":
    case "wavy":
      add({ kind: "path", d: "M30.2 50 C28.2 33 34 19.4 44 18.4 C46 18.2 48 18.2 50 18.4 C62.4 18.8 71.6 28.4 69.8 50 C68.8 43.4 67.6 38.6 65.4 35.4 C60.6 35.6 53.2 33.4 47.4 28.4 C46.4 27.6 45.6 26.8 45 26 C42.4 30 37.4 33.2 33.2 35.2 C31.6 39.6 30.8 44.4 30.2 50 Z", fill });
      add({ kind: "path", d: "M47 22.6 C54 24.6 60.4 28.4 64.6 33.6 M45.6 20.6 C41 23.4 36.4 28 33.6 33.4", stroke: dark, strokeWidth: 0.7, opacity: 0.32 });
      add({ kind: "path", d: "M52.4 21.2 C58.8 21.6 64.2 25.2 66.6 30.4 C63.2 27.4 58.8 25.2 53 24.2 Z", fill: "#FFFFFF", opacity: 0.2 });
      // Strands that fall forward over the shoulders.
      add({ kind: "path", d: "M30.2 46 C29.4 56 30.6 66 34.4 74 C32 75 29.6 74.6 28.4 72.4 C27.4 63 27.8 53 30.2 46 Z", fill });
      add({ kind: "path", d: "M69.8 46 C70.6 56 69.4 66 65.6 74 C68 75 70.4 74.6 71.6 72.4 C72.6 63 72.2 53 69.8 46 Z", fill });
      return;
    case "bob":
      add({ kind: "path", d: "M30 48 C28.6 28.6 38.2 19.2 50 19.2 C61.8 19.2 71.4 28.6 70 48 C69.2 42.8 68.6 39.6 67.6 37.2 C61.8 38.6 56 39.2 50 39.2 C44 39.2 38.2 38.6 32.4 37.2 C31.4 39.6 30.8 42.8 30 48 Z", fill });
      for (const x of [40, 46, 52, 58]) add({ kind: "path", d: `M${x} 31 L${x + 0.6} 38.6`, stroke: dark, strokeWidth: 0.7, opacity: 0.35 });
      sheen("M38 25.6 C42 22.6 47 21.6 51.6 22");
      return;
    case "ponytail":
    case "bun":
    case "puff":
    case "braids":
      // Drawn back from the face, parted in the middle.
      add({ kind: "path", d: "M30.8 45 C29.6 28.8 38.4 20 50 20 C61.6 20 70.4 28.8 69.2 45 C68.2 38 64.8 32.6 58.6 30.4 C55.6 29.4 52.6 29.2 50 29.6 C47.4 29.2 44.4 29.4 41.4 30.4 C35.2 32.6 31.8 38 30.8 45 Z", fill });
      add({ kind: "path", d: "M50 21.4 L50 29.4", stroke: dark, strokeWidth: 0.9, opacity: 0.55 });
      sheen("M38.4 25.4 C41.6 23 45 22 48 21.8");
      sheen("M52 21.8 C55 22 58.4 23 61.6 25.4");
      if (spec.style === "ponytail") add({ kind: "path", d: "M64.2 28.6 C66.4 27.2 68.4 27.8 69 30 C68.6 32 66.6 33 64.6 32.4 Z", fill: lighter(spec.shirt, 0.1) });
      if (spec.style === "bun") add({ kind: "path", d: "M42.6 22.6 C46 21 54 21 57.4 22.6 L57 24.6 C53.6 23.4 46.4 23.4 43 24.6 Z", fill: lighter(spec.shirt, 0.1) });
      if (spec.style === "braids") braids(add, fill, dark, spec.trim);
      return;
    case "curly":
      for (const [cx, cy, r] of [[33.6, 34.6, 7], [40, 27.6, 7.6], [48.4, 24.4, 8], [57, 25.6, 7.8], [64.6, 30.4, 7.2], [68.2, 39, 6], [31.6, 42.4, 5.4], [44.6, 32.4, 5], [55.6, 32.4, 5]] as const) {
        add({ kind: "circle", cx, cy, r, fill });
      }
      for (const [cx, cy] of [[40, 25], [48, 21.6], [57, 23]] as const) add({ kind: "circle", cx, cy, r: 2.2, fill: light, opacity: 0.5 });
      return;
    case "headscarf": {
      const scarf = spec.shirt;
      const edge = lighter(scarf, 0.22);
      // The band that frames the face, then the drape under the chin.
      add({ kind: "path", d: "M29.2 52 C27.6 30.4 37.8 19.6 50 19.6 C62.2 19.6 72.4 30.4 70.8 52 C69.6 44 68.4 38.4 65.4 34.4 C61.6 30.4 56.2 29.2 50 29.2 C43.8 29.2 38.4 30.4 34.6 34.4 C31.6 38.4 30.4 44 29.2 52 Z", fill: scarf });
      add({ kind: "path", d: "M30.2 52 C31.4 44 32.6 38.4 35.4 34.8 C39 31 44 29.8 50 29.8 C56 29.8 61 31 64.6 34.8 C67.4 38.4 68.6 44 69.8 52", stroke: edge, strokeWidth: 1.1, opacity: 0.7 });
      add({ kind: "path", d: "M33 33 C38 27.6 44 26 50 26", stroke: darker(scarf, 0.2), strokeWidth: 0.8, opacity: 0.45 });
      add({ kind: "path", d: "M30.6 51 C32 61.4 40 68.6 50 68.6 C60 68.6 68 61.4 69.4 51 L71.2 58 C72.6 71 63.4 80.4 50 82.4 C36.6 80.4 27.4 71 28.8 58 Z", fill: scarf });
      add({ kind: "path", d: "M24 80.4 C32.6 75.4 41.6 76.6 50 82.4 C58.4 76.6 67.4 75.4 76 80.4 L80 106 L20 106 Z", fill: scarf });
      // A pattern of small flowers along the drape, in the scarf's own trim.
      for (const [cx, cy] of [[36, 74], [44, 79.6], [56, 79.6], [64, 74], [29, 92], [40, 90], [60, 90], [71, 92]] as const) {
        add({ kind: "circle", cx, cy, r: 1.5, fill: spec.trim, opacity: 0.85 });
        add({ kind: "circle", cx, cy, r: 0.6, fill: "#FFFFFF", opacity: 0.9 });
      }
      add({ kind: "path", d: "M42 24.4 C46 22.6 52 22.4 57 23.6", stroke: "#FFFFFF", strokeWidth: 1.4, opacity: 0.28 });
      add({ kind: "path", d: "M50 82.4 L50 96", stroke: darker(scarf, 0.25), strokeWidth: 0.9, opacity: 0.5 });
      return;
    }
    case "short":
      add({ kind: "path", d: "M30.8 45 C29.4 28 38 19.2 50 19.2 C62 19.2 70.6 28 69.2 45 C68.4 39.6 67.2 36 65.2 33.4 C59.6 35.4 52.4 34.6 46.4 32 C41.6 34 36.6 34.8 33.6 34.2 C32.2 37.4 31.4 41 30.8 45 Z", fill });
      add({ kind: "path", d: "M46.4 32 C50 28.6 56 27.4 61.4 28.6", stroke: dark, strokeWidth: 0.8, opacity: 0.45 });
      sheen("M39 25 C43 22.4 48 21.6 52.6 22");
      return;
    case "quiff":
      add({ kind: "path", d: "M30.8 43 C29.6 31 33.6 23.6 39.6 20.4 C40.6 17 44 15 47.8 15.8 C50.6 13.2 55.4 13.4 58 16 C61.6 15.6 65 18 66 21.6 C69.6 25 71 31.4 69.2 43 C68 37.6 66.2 34.4 63.4 32.6 C58 34 51.6 34 45.6 33 C40.6 32.4 36.8 32.8 34.2 34 C32.6 36.4 31.4 39.4 30.8 43 Z", fill });
      add({ kind: "path", d: "M44 19 C47 22 49 26 49 31 M53.4 17.6 C56 21 57 25 56.6 30", stroke: dark, strokeWidth: 0.9, opacity: 0.4 });
      sheen("M41 21.6 C44 18.6 48 17.6 51.6 18.2");
      return;
    case "fade":
      add({ kind: "path", d: "M32.4 38 C32 26.6 39.6 20 50 20 C60.4 20 68 26.6 67.6 38 C62.6 33.6 56.4 32 50 32 C43.6 32 37.4 33.6 32.4 38 Z", fill });
      for (const side of [-1, 1]) {
        const x = 50 + side * 17.6;
        add({ kind: "path", d: `M${x} 36 C${x + side * 1.4} 39 ${x + side * 1.4} 42 ${x + side * 1.2} 46 L${x - side * 1.4} 46 C${x - side * 1.6} 42 ${x - side * 1.2} 39 ${x - side * 2.4} 36.6 Z`, fill, opacity: 0.45 });
      }
      add({ kind: "path", d: "M38 28.6 L37 31.8 M44 25.6 L43.6 29.4 M50 25 L50 29 M56 25.6 L56.4 29.4 M62 28.6 L63 31.8", stroke: light, strokeWidth: 0.7, opacity: 0.4 });
      return;
    case "crew":
      add({ kind: "path", d: "M31.4 41.6 C30.8 27.8 39 20.6 50 20.6 C61 20.6 69.2 27.8 68.6 41.6 C66.8 35.8 63 32.6 58 31.6 C55 31 52.4 30.8 50 30.8 C47.6 30.8 45 31 42 31.6 C37 32.6 33.2 35.8 31.4 41.6 Z", fill });
      sheen("M40 24.6 C43.6 22.6 47.4 22 51 22.2");
      return;
    case "sideswept":
      add({ kind: "path", d: "M30.6 46 C29.2 28.4 38 19 50.4 19 C62.6 19 71.2 28 69.4 44 C68.6 39.2 67.2 35.8 65 33.6 C61.4 37.2 54.6 39.8 46.4 39.4 C40.4 39 35.6 37.4 33 35.4 C31.8 38.6 31 42 30.6 46 Z", fill });
      add({ kind: "path", d: "M36 34.6 C44 34.8 54 32.6 62.6 27.6 M40 37.4 C48 37.4 56 35.6 63.8 31", stroke: dark, strokeWidth: 0.8, opacity: 0.4 });
      sheen("M40.6 24 C46 21.4 53 21.2 58.6 23.4");
      return;
    case "curlyShort":
      for (const [cx, cy, r] of [[34.6, 33.4, 5.4], [40.4, 27.4, 6], [47.6, 24.2, 6.4], [55, 24.4, 6.4], [61.6, 28, 6], [66, 34.4, 5.2], [32.6, 40, 4], [67.6, 40.4, 4]] as const) {
        add({ kind: "circle", cx, cy, r, fill });
      }
      for (const [cx, cy] of [[40, 25.4], [47.6, 21.6], [55, 21.8]] as const) add({ kind: "circle", cx, cy, r: 1.8, fill: light, opacity: 0.45 });
      return;
    case "afro":
      for (const [cx, cy] of [[38, 22], [50, 17], [62, 22]] as const) add({ kind: "circle", cx, cy, r: 3.2, fill: light, opacity: 0.35 });
      // The hairline: the top of the head is hair, edged in small coils.
      add({ kind: "path", d: "M31.2 42 C30 27 38.6 19.6 50 19.6 C61.4 19.6 70 27 68.8 42 C67.4 35.6 63.6 31.4 58 30.4 C55.4 30 52.6 29.8 50 29.8 C47.4 29.8 44.6 30 42 30.4 C36.4 31.4 32.6 35.6 31.2 42 Z", fill });
      for (const [cx, cy] of [[34.6, 35.4], [38.6, 31.8], [43.6, 30.2], [50, 29.8], [56.4, 30.2], [61.4, 31.8], [65.4, 35.4]] as const) add({ kind: "circle", cx, cy, r: 2, fill });
      return;
    case "cap": {
      const cap = spec.trim;
      add({ kind: "path", d: "M30.8 46 C29.8 38 31 33.6 33.4 31.6 L66.6 31.6 C69 33.6 70.2 38 69.2 46 C68.4 41 66.6 37.4 64 35.6 L36 35.6 C33.4 37.4 31.6 41 30.8 46 Z", fill });
      add({ kind: "path", d: "M30.4 37 C30.4 23.6 39.2 16.6 50 16.6 C60.8 16.6 69.6 23.6 69.6 37 Z", fill: cap });
      add({ kind: "path", d: "M50 16.8 L50 36.8 M40.6 18.8 C38.6 24 38 30 38.4 36.8 M59.4 18.8 C61.4 24 62 30 61.6 36.8", stroke: darker(cap, 0.25), strokeWidth: 0.7, opacity: 0.6 });
      add({ kind: "circle", cx: 50, cy: 17, r: 1.6, fill: darker(cap, 0.25) });
      add({ kind: "path", d: "M27.6 36.4 C36 34 64 34 72.4 36.4 C73.6 37.4 73.2 39.6 71.6 40 C62 38.4 38 38.4 28.4 40 C26.8 39.6 26.4 37.4 27.6 36.4 Z", fill: darker(cap, 0.18) });
      add({ kind: "path", d: "M36 21.6 C40 18.8 45 17.8 49 17.8", stroke: "#FFFFFF", strokeWidth: 1.4, opacity: 0.35 });
      return;
    }
  }
}

function braids(add: (shape: GameAvatarShape) => void, fill: string, dark: string, tie: string) {
  for (const side of [-1, 1]) {
    const x = 50 + side * 19.6;
    for (let at = 0; at < 6; at += 1) {
      const cy = 48 + at * 5.2;
      const cx = x + side * (at < 3 ? at * 0.5 : 1.5 - (at - 3) * 0.4);
      add({ kind: "ellipse", cx, cy, rx: 3.6 - at * 0.15, ry: 3.2, fill });
      add({ kind: "path", d: `M${cx - 2.6} ${cy - 1} Q${cx} ${cy + 1.6} ${cx + 2.6} ${cy - 1}`, stroke: dark, strokeWidth: 0.7, opacity: 0.5 });
    }
    add({ kind: "rect", x: x + side * 1.2 - 2, y: 78.6, w: 4, h: 2.4, rx: 1.2, fill: tie });
    add({ kind: "path", d: `M${x + side * 1.2 - 1.6} 81 L${x + side * 1.2} 85.4 L${x + side * 1.2 + 1.6} 81 Z`, fill });
  }
}

/* --------------------------------------------------------------- clothes */

function outfit(
  spec: GameAvatarSpec, add: (shape: GameAvatarShape) => void, fill: string, shade: string, light: string,
  bodyClip: string,
) {
  if (spec.outfit === "hoodie") {
    // The hood lies around the neck, behind the collar line.
    add({ kind: "path", d: "M31 82 C31 72 39.4 68.6 50 68.6 C60.6 68.6 69 72 69 82 Z", fill: shade });
  }
  add({ kind: "path", d: BODY, fill });
  // Shoulder seams catch the light; the far side falls into shade.
  add({ kind: "path", d: "M64 77 C76 80 86 87 88 100 L74 100 C73 90 69 82 64 77 Z", fill: shade, opacity: 0.35, clip: bodyClip });

  switch (spec.outfit) {
    case "tee":
      add({ kind: "path", d: NECKLINE, stroke: shade, strokeWidth: 2.2 });
      add({ kind: "path", d: "M38.6 77.6 C42 80.4 46 81.8 50 81.8", stroke: light, strokeWidth: 0.8, opacity: 0.7 });
      return;
    case "sweater":
      add({ kind: "path", d: "M36.8 76.2 C40.8 79.8 45.2 81.4 50 81.4 C54.8 81.4 59.2 79.8 63.2 76.2", stroke: shade, strokeWidth: 3.4 });
      for (const x of [41, 44.6, 48.2, 51.8, 55.4, 59]) add({ kind: "path", d: `M${x} ${x < 50 ? 78.6 + (x - 41) * 0.3 : 81.2 - (x - 51.8) * 0.3} l0 2`, stroke: lighter(shade, 0.25), strokeWidth: 0.5, opacity: 0.6 });
      return;
    case "vneck":
      add({ kind: "path", d: "M38 76.6 L50 92 L62 76.6 C58 79 54 80.2 50 80.2 C46 80.2 42 79 38 76.6 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M41.6 77.6 L50 84.6 L58.4 77.6 L56.6 82.6 L50 88 L43.4 82.6 Z", fill: "#F4F6FA" });
      add({ kind: "path", d: "M37.4 76.2 L50 92.6 L62.6 76.2", stroke: shade, strokeWidth: 2.4 });
      return;
    case "hoodie":
      add({ kind: "path", d: NECKLINE, stroke: shade, strokeWidth: 2 });
      add({ kind: "path", d: "M45.4 81 C45.2 85 44.8 88 44.4 91 M54.6 81 C54.8 85 55.2 88 55.6 91", stroke: spec.trim, strokeWidth: 1.2 });
      add({ kind: "rect", x: 43.4, y: 90.4, w: 2, h: 3, rx: 0.8, fill: lighter(shade, 0.3) });
      add({ kind: "rect", x: 54.6, y: 90.4, w: 2, h: 3, rx: 0.8, fill: lighter(shade, 0.3) });
      return;
    case "collar": {
      const tie = spec.trim;
      add({ kind: "path", d: "M50 81 L50 106", stroke: shade, strokeWidth: 0.8 });
      for (const y of [88, 95]) add({ kind: "circle", cx: 50, cy: y, r: 0.8, fill: shade });
      add({ kind: "path", d: "M47.6 81.6 L52.4 81.6 L53.4 84 L51.4 86 L52.8 97 L50 100 L47.2 97 L48.6 86 L46.6 84 Z", fill: tie });
      add({ kind: "path", d: "M36.8 75.8 L48.8 81.4 L44.2 87.4 C41.6 84 39 80.4 36.8 75.8 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M63.2 75.8 L51.2 81.4 L55.8 87.4 C58.4 84 61 80.4 63.2 75.8 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M36.8 75.8 L48.8 81.4 L44.2 87.4 M63.2 75.8 L51.2 81.4 L55.8 87.4", stroke: "#C9D1DE", strokeWidth: 0.7 });
      return;
    }
    case "jacket":
      add({ kind: "path", d: "M39.4 76.4 L50 94 L60.6 76.4 C57 78.8 53.6 80 50 80 C46.4 80 43 78.8 39.4 76.4 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: "M36.6 76.2 L44 84 L41 88 L48.4 104 L36 104 C34 94 34 84 36.6 76.2 Z", fill: shade });
      add({ kind: "path", d: "M63.4 76.2 L56 84 L59 88 L51.6 104 L64 104 C66 94 66 84 63.4 76.2 Z", fill: shade });
      add({ kind: "path", d: "M36.6 76.2 L44 84 L41 88 L48.4 104 M63.4 76.2 L56 84 L59 88 L51.6 104", stroke: light, strokeWidth: 0.6, opacity: 0.6 });
      return;
    case "chapan": {
      // Atlas: soft-edged ikat stripes running down the robe.
      const stripes = [spec.trim, "#FFFFFF", "#F2B23A", spec.trim, "#FFFFFF", "#F2B23A", spec.trim];
      stripes.forEach((color, at) => {
        const x = 14 + at * 12;
        add({
          kind: "path",
          d: `M${x} 76 C${x + 3} 80 ${x - 3} 84 ${x} 88 C${x + 3} 92 ${x - 3} 96 ${x} 100 L${x} 106 L${x + 4.4} 106 L${x + 4.4} 100 C${x + 1.4} 96 ${x + 7.4} 92 ${x + 4.4} 88 C${x + 1.4} 84 ${x + 7.4} 80 ${x + 4.4} 76 Z`,
          fill: color, opacity: color === "#FFFFFF" ? 0.55 : 0.8, clip: bodyClip,
        });
      });
      // The robe's front edges, trimmed in braid.
      add({ kind: "path", d: "M38 76.8 C43 86 46.6 94 47.6 106 M62 76.8 C57 86 53.4 94 52.4 106", stroke: "#1E1A22", strokeWidth: 2.8, opacity: 0.85 });
      add({ kind: "path", d: "M38 76.8 C43 86 46.6 94 47.6 106 M62 76.8 C57 86 53.4 94 52.4 106", stroke: "#F2C14E", strokeWidth: 1, opacity: 0.95 });
      add({ kind: "path", d: "M41.6 78.6 C44.4 80.4 47.2 81.2 50 81.2 C52.8 81.2 55.6 80.4 58.4 78.6 L52.6 90 L47.4 90 Z", fill: "#FFFFFF" });
      add({ kind: "path", d: NECKLINE, stroke: shade, strokeWidth: 1.6 });
      return;
    }
  }
}

/* ----------------------------------------------------------- accessories */

function doppi(add: (shape: GameAvatarShape) => void, flowered: boolean, colour: string) {
  const cap = flowered ? colour : "#17141C";
  add({ kind: "path", d: "M33 31.4 L35.4 19.6 C41 16.4 59 16.4 64.6 19.6 L67 31.4 C60 29 40 29 33 31.4 Z", fill: cap });
  add({ kind: "path", d: "M33 31.4 C40 29 60 29 67 31.4 L66.6 33.6 C59.6 31.2 40.4 31.2 33.4 33.6 Z", fill: flowered ? darker(colour, 0.3) : "#2B2633" });
  add({ kind: "path", d: "M35.4 19.6 C41 16.4 59 16.4 64.6 19.6", stroke: "#FFFFFF", strokeWidth: 0.6, opacity: 0.35 });
  if (flowered) {
    // Gulli do‘ppi: flowers stitched in four corners.
    for (const [cx, cy] of [[40, 24.6], [50, 22.6], [60, 24.6]] as const) {
      for (const [dx, dy] of [[0, -1.6], [1.6, 0], [0, 1.6], [-1.6, 0]] as const) add({ kind: "circle", cx: cx + dx, cy: cy + dy, r: 1.2, fill: "#FFE08A" });
      add({ kind: "circle", cx, cy, r: 0.9, fill: "#2E7BD6" });
    }
    return;
  }
  // Chust do‘ppi: a white qalampir — a pepper whose tip hooks over — on each
  // face, the front one whole and the two beside it turned away; and the
  // white stitching along its corners and band.
  qalampir(add, 50, 24.6, 1.05, 0);
  qalampir(add, 40, 25.2, 0.78, -18);
  qalampir(add, 60, 25.2, 0.78, 18, true);
  add({ kind: "path", d: "M36.2 20.6 L34.2 31 M63.8 20.6 L65.8 31", stroke: "#FFFFFF", strokeWidth: 0.6, opacity: 0.6 });
  add({ kind: "path", d: "M33.6 32.4 C40.4 30.2 59.6 30.2 66.4 32.4", stroke: "#FFFFFF", strokeWidth: 0.5, opacity: 0.55 });
}

/** One qalampir, `scale` times its natural size, turned by `angle` degrees. */
function qalampir(add: (shape: GameAvatarShape) => void, cx: number, cy: number, scale: number, angle: number, mirror = false) {
  const turn = (angle * Math.PI) / 180;
  const flip = mirror ? -1 : 1;
  const at = (x: number, y: number) => {
    const lx = x * scale * flip;
    const ly = y * scale;
    return `${(cx + lx * Math.cos(turn) - ly * Math.sin(turn)).toFixed(2)} ${(cy + lx * Math.sin(turn) + ly * Math.cos(turn)).toFixed(2)}`;
  };
  add({
    kind: "path",
    d: `M${at(0, 5.2)} C${at(-3.4, 4.6)} ${at(-3.6, -0.6)} ${at(-1.2, -3)} C${at(0, -4.2)} ${at(1.6, -5)} ${at(3.2, -4.6)} C${at(1.6, -3.6)} ${at(1.2, -2.2)} ${at(2, 0)} C${at(2.8, 2.4)} ${at(2.2, 4.8)} ${at(0, 5.2)} Z`,
    fill: "#FFFFFF",
  });
}

function glasses(add: (shape: GameAvatarShape) => void, round: boolean) {
  const frame = "#2A2230";
  for (const x of EYE_X) {
    if (round) add({ kind: "circle", cx: x, cy: EYE_Y + 0.6, r: 5.4, fill: "#FFFFFF", opacity: 0.12 });
    else add({ kind: "rect", x: x - 5.8, y: EYE_Y - 3.8, w: 11.6, h: 8.6, rx: 2.6, fill: "#FFFFFF", opacity: 0.12 });
    if (round) add({ kind: "circle", cx: x, cy: EYE_Y + 0.6, r: 5.4, stroke: frame, strokeWidth: 1.3 });
    else add({ kind: "rect", x: x - 5.8, y: EYE_Y - 3.8, w: 11.6, h: 8.6, rx: 2.6, stroke: frame, strokeWidth: 1.3 });
    add({ kind: "path", d: `M${x - 3.4} ${EYE_Y - 1.6} L${x - 1.2} ${EYE_Y - 3}`, stroke: "#FFFFFF", strokeWidth: 0.9, opacity: 0.7 });
  }
  add({ kind: "path", d: `M${EYE_X[0] + (round ? 5.4 : 5.8)} ${EYE_Y} Q50 ${EYE_Y - 1.6} ${EYE_X[1] - (round ? 5.4 : 5.8)} ${EYE_Y}`, stroke: frame, strokeWidth: 1.2 });
  add({ kind: "path", d: `M${EYE_X[0] - (round ? 5.4 : 5.8)} ${EYE_Y - 0.6} L31.4 ${EYE_Y - 1.6} M${EYE_X[1] + (round ? 5.4 : 5.8)} ${EYE_Y - 0.6} L68.6 ${EYE_Y - 1.6}`, stroke: frame, strokeWidth: 1.2 });
}
