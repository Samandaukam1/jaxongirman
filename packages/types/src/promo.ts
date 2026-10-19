/**
 * "Jaxongirman tavsiya qiladi": the shape of a recommendation or advertisement,
 * shared by the admin console that writes one and the app that draws it.
 *
 * The database stores the article as a JSON list and checks only that it is a
 * list; this file is the contract. `normalizePromoBody` is what both sides run
 * on whatever they read, so a block with a missing field or an unknown type is
 * repaired or dropped instead of taking a screen down.
 */

export type PromoKind = "recommendation" | "ad";
export type PromoStatus = "draft" | "published" | "archived";
export type PromoMediaKind = "image" | "video";
export type PromoAction = "article" | "link";
/** `overlay`: title, subtitle, shade and arrow over the banner. `image`: the picture alone. */
export type PromoBannerStyle = "overlay" | "image";

/** The article's typeface. Each is a pair: one face for headings, one for text. */
export type PromoFont = "editorial" | "modern" | "classic";

export type PromoTheme = {
  font: PromoFont;
  /** Quotes, dividers, list markers and links. */
  accent: string;
};

export const DEFAULT_PROMO_THEME: PromoTheme = { font: "editorial", accent: "#6C34C9" };

export type PromoButtonFill = "gradient" | "solid" | "outline";

export type PromoButton = {
  label: string;
  /** `https://…` opens outside the app; `/…` is a screen inside it. */
  url: string;
  fill: PromoButtonFill;
  /** Start and end of the gradient; a solid or outlined button uses the first. */
  colors: [string, string];
  /** A slow pulse of light round the button. */
  glow: boolean;
  /** Held at the bottom of the screen while the article scrolls, instead of in the text. */
  pinned: boolean;
};

export type PromoCalloutTone = "brand" | "gold" | "success" | "danger";

export type PromoBlock =
  | { id: string; type: "heading"; text: string; level: 1 | 2 }
  | { id: string; type: "text"; text: string; size: "regular" | "large"; align: "left" | "center" }
  | { id: string; type: "quote"; text: string; cite: string }
  | { id: string; type: "callout"; text: string; tone: PromoCalloutTone }
  | { id: string; type: "image"; url: string; caption: string }
  | { id: string; type: "video"; url: string; caption: string }
  | { id: string; type: "audio"; url: string; title: string; caption: string }
  | { id: string; type: "list"; items: string[]; ordered: boolean }
  | { id: string; type: "divider" }
  | { id: string; type: "button"; button: PromoButton };

export type PromoBlockType = PromoBlock["type"];

/** A row of `public.promos`, as both sides read it. */
export type Promo = {
  id: string;
  kind: PromoKind;
  status: PromoStatus;
  title: string;
  subtitle: string;
  sponsor: string;
  /** null: the default label for the kind; "": no label; anything else: that text. */
  badge: string | null;
  banner_url: string | null;
  banner_kind: PromoMediaKind;
  banner_style: PromoBannerStyle;
  hero_url: string | null;
  hero_kind: PromoMediaKind;
  action: PromoAction;
  link_url: string | null;
  body: PromoBlock[];
  theme: PromoTheme;
  position: number;
  starts_at: string | null;
  ends_at: string | null;
  view_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * The sizes the console asks for, and the app draws at.
 *
 * The banner is wide and short on purpose — 16:6 — so a carousel of them reads
 * as a strip of cards under the balance rather than a wall of posters. The hero
 * at the top of an article is tall enough to fill the top of a phone.
 */
export const PROMO_BANNER_RATIO = 16 / 6;
export const PROMO_BANNER_SIZE = { width: 1600, height: 600 } as const;
export const PROMO_HERO_RATIO = 1290 / 1400;
export const PROMO_HERO_SIZE = { width: 1290, height: 1400 } as const;

export const PROMO_GRADIENTS: readonly { name: string; colors: [string, string] }[] = [
  { name: "Binafsha", colors: ["#8B54E8", "#4B1FA8"] },
  { name: "Oltin", colors: ["#F6C453", "#C27C0E"] },
  { name: "Okean", colors: ["#38BDF8", "#1D4ED8"] },
  { name: "Zumrad", colors: ["#34D399", "#047857"] },
  { name: "Olov", colors: ["#FB7185", "#E11D48"] },
  { name: "Tun", colors: ["#334155", "#0F172A"] },
];

/** Colours the console offers for text; any `#RRGGBB` works. */
export const PROMO_TEXT_COLORS = ["#6C34C9", "#E11D48", "#D97706", "#059669", "#2563EB", "#DB2777", "#0F172A"] as const;

/* ------------------------------------------------------------ inline text */

/**
 * One run of text with the same look.
 *
 * The console writes formatting as light markup inside a text block — the same
 * marks a person would type in a chat — and both sides read it with
 * `parseInline`:
 *
 *   **qalin**   *qiya*   __tagiga chizilgan__   ~~o‘chirilgan~~
 *   [havola](https://…)         {#E11D48}rangli matn{/}
 *   {bg:#FFE66D}belgilangan{/}  \* — a mark character typed literally
 */
export type PromoSpan = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  highlight: string | null;
  href: string | null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
// The address may hold balanced parentheses: an app route is `/(app)/create`.
const LINK = /^\[([^\]\n]+)\]\(((?:https?:\/\/|\/)(?:[^\s()]|\([^\s()]*\))*)\)/;
const OPEN_COLOR = /^\{(bg:)?(#[0-9a-fA-F]{6})\}/;

type InlineStyle = Omit<PromoSpan, "text">;

function parseRuns(source: string, base: InlineStyle): PromoSpan[] {
  const spans: PromoSpan[] = [];
  const style: InlineStyle = { ...base };
  const colors: { highlight: boolean; value: string }[] = [];
  let buffer = "";

  const current = (): InlineStyle => {
    const color = [...colors].reverse().find((entry) => !entry.highlight)?.value ?? base.color;
    const highlight = [...colors].reverse().find((entry) => entry.highlight)?.value ?? base.highlight;
    return { ...style, color, highlight };
  };
  const flush = () => {
    if (!buffer) return;
    const look = current();
    const last = spans[spans.length - 1];
    // Neighbouring runs that look the same are one run.
    if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...look, text: "" })) last.text += buffer;
    else spans.push({ text: buffer, ...look });
    buffer = "";
  };

  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const char = source[at]!;
    if (char === "\\" && at + 1 < source.length) {
      buffer += source[at + 1];
      at += 2;
      continue;
    }
    if (rest.startsWith("**")) { flush(); style.bold = !style.bold; at += 2; continue; }
    if (rest.startsWith("__")) { flush(); style.underline = !style.underline; at += 2; continue; }
    if (rest.startsWith("~~")) { flush(); style.strike = !style.strike; at += 2; continue; }
    if (char === "*") { flush(); style.italic = !style.italic; at += 1; continue; }
    if (char === "[") {
      const link = LINK.exec(rest);
      if (link) {
        flush();
        for (const span of parseRuns(link[1]!, { ...current(), href: link[2]! })) {
          const last = spans[spans.length - 1];
          if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...span, text: "" })) last.text += span.text;
          else spans.push(span);
        }
        at += link[0].length;
        continue;
      }
    }
    if (char === "{") {
      const open = OPEN_COLOR.exec(rest);
      if (open) {
        flush();
        colors.push({ highlight: Boolean(open[1]), value: open[2]!.toUpperCase() });
        at += open[0].length;
        continue;
      }
      if (rest.startsWith("{/}")) {
        flush();
        colors.pop();
        at += 3;
        continue;
      }
    }
    buffer += char;
    at += 1;
  }
  flush();
  return spans;
}

const PLAIN: InlineStyle = {
  bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, href: null,
};

/** Formatted text as runs, ready to draw. Unclosed marks run to the end of the block. */
export function parseInline(source: string): PromoSpan[] {
  return parseRuns(source ?? "", PLAIN);
}

/** The text alone, with every mark removed — for a preview line or a screen reader. */
export function plainInline(source: string): string {
  return parseInline(source).map((span) => span.text).join("");
}

/* -------------------------------------------------------------- normalise */

function text(value: unknown, max = 20_000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function url(value: unknown): string {
  const candidate = text(value, 2_000).trim();
  return /^(https?:\/\/|\/)/i.test(candidate) ? candidate : "";
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : fallback;
}

let generated = 0;
/** A block id that is unique within one article; not a database key. */
export function promoBlockId(): string {
  generated += 1;
  return `b${Date.now().toString(36)}${generated.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizePromoButton(raw: unknown): PromoButton {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors = Array.isArray(value.colors) ? value.colors : [];
  const first = hex(colors[0], PROMO_GRADIENTS[0]!.colors[0]);
  return {
    label: text(value.label, 60) || "Batafsil",
    url: url(value.url),
    fill: value.fill === "solid" || value.fill === "outline" ? value.fill : "gradient",
    colors: [first, hex(colors[1], first)],
    glow: value.glow === true,
    pinned: value.pinned === true,
  };
}

/** One block as the app may trust it, or null for one it cannot draw. */
export function normalizePromoBlock(raw: unknown): PromoBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = text(value.id, 64) || promoBlockId();
  switch (value.type) {
    case "heading":
      return { id, type: "heading", text: text(value.text, 300), level: value.level === 2 ? 2 : 1 };
    case "text":
      return {
        id, type: "text", text: text(value.text),
        size: value.size === "large" ? "large" : "regular",
        align: value.align === "center" ? "center" : "left",
      };
    case "quote":
      return { id, type: "quote", text: text(value.text, 2_000), cite: text(value.cite, 120) };
    case "callout":
      return {
        id, type: "callout", text: text(value.text, 2_000),
        tone: value.tone === "gold" || value.tone === "success" || value.tone === "danger" ? value.tone : "brand",
      };
    case "image":
      return { id, type: "image", url: url(value.url), caption: text(value.caption, 300) };
    case "video":
      return { id, type: "video", url: url(value.url), caption: text(value.caption, 300) };
    case "audio":
      return { id, type: "audio", url: url(value.url), title: text(value.title, 140), caption: text(value.caption, 300) };
    case "list":
      return {
        id, type: "list", ordered: value.ordered === true,
        items: (Array.isArray(value.items) ? value.items : []).map((item) => text(item, 1_000)).slice(0, 50),
      };
    case "divider":
      return { id, type: "divider" };
    case "button":
      return { id, type: "button", button: normalizePromoButton(value.button) };
    default:
      return null;
  }
}

export function normalizePromoBody(raw: unknown): PromoBlock[] {
  return (Array.isArray(raw) ? raw : []).map(normalizePromoBlock).filter((block): block is PromoBlock => block !== null);
}

export function normalizePromoTheme(raw: unknown): PromoTheme {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    font: value.font === "modern" || value.font === "classic" ? value.font : "editorial",
    accent: hex(value.accent, DEFAULT_PROMO_THEME.accent),
  };
}

/** A database row with its JSON columns made safe to draw. */
export function normalizePromo(row: Record<string, unknown>): Promo {
  return {
    ...(row as unknown as Promo),
    title: text(row.title, 140),
    subtitle: text(row.subtitle, 280),
    sponsor: text(row.sponsor, 80),
    badge: typeof row.badge === "string" ? row.badge.trim().slice(0, 24) : null,
    banner_kind: row.banner_kind === "video" ? "video" : "image",
    banner_style: row.banner_style === "image" ? "image" : "overlay",
    hero_kind: row.hero_kind === "video" ? "video" : "image",
    action: row.action === "link" ? "link" : "article",
    body: normalizePromoBody(row.body),
    theme: normalizePromoTheme(row.theme),
    view_count: Number(row.view_count ?? 0),
    click_count: Number(row.click_count ?? 0),
  };
}

/**
 * The label a banner carries, or null for none.
 *
 * `adLabel` is the word for "advertisement" in the reader's language: an
 * advertisement left on its default shows it; a recommendation on its default
 * shows nothing. The console can replace either with its own text or remove it.
 */
export function promoBadgeText(promo: Pick<Promo, "kind" | "badge">, adLabel: string): string | null {
  if (promo.badge === null) return promo.kind === "ad" ? adLabel : null;
  return promo.badge.trim() || null;
}

/** A new, empty block of the given type, as the console inserts it. */
export function emptyPromoBlock(type: PromoBlockType): PromoBlock {
  const id = promoBlockId();
  switch (type) {
    case "heading": return { id, type, text: "", level: 2 };
    case "text": return { id, type, text: "", size: "regular", align: "left" };
    case "quote": return { id, type, text: "", cite: "" };
    case "callout": return { id, type, text: "", tone: "brand" };
    case "image": return { id, type, url: "", caption: "" };
    case "video": return { id, type, url: "", caption: "" };
    case "audio": return { id, type, url: "", title: "", caption: "" };
    case "list": return { id, type, items: [""], ordered: false };
    case "divider": return { id, type };
    case "button": return {
      id, type,
      button: { label: "Batafsil", url: "", fill: "gradient", colors: [...PROMO_GRADIENTS[0]!.colors], glow: false, pinned: false },
    };
  }
}
