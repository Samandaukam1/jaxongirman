/**
 * Icons for slides: which one a piece of text calls for, and its outline.
 *
 * The set is Phosphor's (`icon-set.ts`, generated). A slide's icon row carries
 * its own path data, so the phone, the web viewer, the PDF and the PowerPoint
 * exporter all draw the same shape without an icon library of their own, and
 * fill it with whatever the deck asks — a solid colour, a gradient — over a
 * soft shadow.
 *
 * The writer is asked to name an icon from the set for every point; when it
 * names none, or one outside the set, the text itself picks one by keyword.
 */

import { ICON_BOX, ICON_SET, type IconPath } from "./icon-set.ts";

export const ICON_NAMES: string[] = Object.keys(ICON_SET);

export function isIcon(name: unknown): name is string {
  return typeof name === "string" && name in ICON_SET;
}

/** Lower case, apostrophes of every kind dropped: "Ta’lim", "ta'lim" and "talim" read alike. */
function normal(text: string): string {
  return text.toLocaleLowerCase("uz").replace(/[’‘ʻʼ'`´]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

type Keyword = { icon: string; word: string; phrase: boolean };
const KEYWORDS: Keyword[] = Object.entries(ICON_SET).flatMap(([icon, entry]) =>
  entry.keywords.map((keyword) => {
    const word = normal(keyword);
    return { icon, word, phrase: word.includes(" ") };
  }).filter((keyword) => keyword.word.length >= 2));

/** Used in turn when nothing in the text names a subject. */
const GENERIC = ["sparkle", "lightbulb", "target", "seal-check", "star", "check-circle", "path", "chart-line-up"];

/**
 * The icon whose words best match a piece of text.
 *
 * A keyword matches the start of a word, so the endings Uzbek adds still find
 * it ("texnologiyalar" finds "texnologiya"); two-letter keywords ("ai", "oy")
 * must be the whole word. Longer matches outweigh shorter ones. Icons already
 * used on the page are passed in `avoid`, so a row of cards does not repeat one.
 */
export function pickIcon(text: string, avoid: ReadonlySet<string> = new Set(), turn = 0): string {
  const said = normal(text);
  const words = said.split(" ");
  const score = new Map<string, number>();
  for (const keyword of KEYWORDS) {
    if (avoid.has(keyword.icon)) continue;
    const hit = keyword.phrase
      ? said.includes(keyword.word)
      : keyword.word.length <= 2
        ? words.includes(keyword.word)
        : words.some((word) => word.startsWith(keyword.word));
    if (hit) score.set(keyword.icon, (score.get(keyword.icon) ?? 0) + keyword.word.length);
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const free = GENERIC.filter((icon) => !avoid.has(icon));
  return (free.length ? free : GENERIC)[turn % (free.length || GENERIC.length)]!;
}

/** An icon's outline in one of its weights, ready to be written into a row. */
export function iconVector(name: string, weight: "fill" | "duo" | "line"): { box: number; paths: IconPath[] } {
  const entry = ICON_SET[name] ?? ICON_SET.sparkle!;
  return {
    box: ICON_BOX,
    paths: weight === "duo" ? entry.duo : (weight === "line" ? entry.line : entry.fill).map((d) => ({ d, opacity: 1 })),
  };
}

/**
 * What an older phone build draws instead: it knows Lucide by name only. A
 * handful map to their Lucide twin; the rest fall back to its sparkle.
 */
const LUCIDE: Record<string, string> = {
  "graduation-cap": "GraduationCap", "book-open": "BookOpen", brain: "Brain", lightbulb: "Lightbulb", target: "Target",
  flag: "Flag", trophy: "Trophy", star: "Star", atom: "Atom", flask: "FlaskConical", dna: "Dna", microscope: "Microscope",
  "rocket-launch": "Rocket", robot: "Bot", cpu: "Cpu", "device-mobile": "Smartphone", cloud: "Cloud", database: "Database",
  code: "Code", gear: "Settings", lightning: "Zap", leaf: "Leaf", tree: "TreePine", sun: "Sun", moon: "Moon", globe: "Globe",
  factory: "Factory", bank: "Landmark", coins: "Coins", "chart-line-up": "TrendingUp", "chart-bar": "BarChart3",
  "chart-pie": "PieChart", scales: "Scale", "shield-check": "ShieldCheck", lock: "Lock", handshake: "Handshake",
  "users-three": "Users", users: "Users", user: "User", heart: "Heart", heartbeat: "HeartPulse", pill: "Pill",
  stethoscope: "Stethoscope", car: "Car", airplane: "Plane", truck: "Truck", compass: "Compass", house: "Home",
  briefcase: "Briefcase", calendar: "Calendar", clock: "Clock", hourglass: "Hourglass", palette: "Palette",
  "music-notes": "Music", camera: "Camera", microphone: "Mic", newspaper: "Newspaper", megaphone: "Megaphone",
  envelope: "Mail", sparkle: "Sparkles", "check-circle": "CheckCircle2", warning: "AlertTriangle", question: "HelpCircle",
  eye: "Eye", laptop: "Laptop", "game-controller": "Gamepad2", "magnifying-glass": "Search", recycle: "Recycle",
  drop: "Droplets", fire: "Flame", wind: "Wind", thermometer: "Thermometer", "map-trifold": "Map",
};

export function lucideName(name: string): string {
  return LUCIDE[name] ?? "Sparkles";
}
