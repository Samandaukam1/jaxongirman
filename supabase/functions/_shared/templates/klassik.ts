import type { ColorRole, LayoutRecipe, Slot, SlideTemplate } from "../design-types.ts";
import { chart, defaultScale, img, rule, shape, txt } from "./kit.ts";

/**
 * KLASSIK — built to the written brief:
 *
 *  · the slide is a rounded card, not a rectangle
 *  · three distinct type voices on one slide, each in its own colour:
 *      Pinyon Script eyebrow → League Spartan headline → Arimo body
 *  · the text block rotates through nine placements down the deck
 *  · a generated 3D glass object fills the background — but only where it earns
 *    its place: the opening slide always, the second slide never, the rest only
 *    when the writer asks for one (see `imagePolicy: "contextual"`)
 *  · wherever text sits on imagery it gets a translucent glass panel beneath it,
 *    which is what keeps the headline readable over a busy render
 */

const CARD = [14, 12, 972, 538] as const;
const CARD_RADIUS = 34;
const PANEL_RADIUS = 26;

/** Full-bleed dark ground, then the rounded card the whole design lives inside. */
function frame(ground: ColorRole, cardColor: ColorRole | null): Slot[] {
  const slots: Slot[] = [shape([0, 0, 1000, 562.5], ground, { round: 0, z: 0 })];
  if (cardColor) slots.push(shape([...CARD] as unknown as [number, number, number, number], cardColor, { round: CARD_RADIUS, z: 1 }));
  return slots;
}

/** Author row lifted from the reference cards: mark plus name, domain pill. */
function header(tint: ColorRole = "accent", text: ColorRole = "textOnContrast"): Slot[] {
  return [
    shape([64, 52, 22, 22], tint, { round: 7, z: 6 }),
    txt("brand", [96, 52, 300, 26], "caption", text, { family: "body", weight: 700, fit: { maxLines: 1 }, z: 6 }),
    shape([760, 46, 176, 36], "surface", { round: "full", opacity: 0.14, outline: "border", outlineWidth: 1, z: 6 }),
    txt("pageNumber", [760, 55, 176, 22], "caption", text, { family: "body", align: "center", fit: { maxLines: 1 }, z: 7 }),
  ];
}

type Anchor = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

const BLOCK_WIDTH = 520;
const CENTER_WIDTH = 660;
const EYEBROW_H = 44;
const TITLE_H = 132;
const BODY_H = 116;
const BLOCK_H = EYEBROW_H + TITLE_H + BODY_H;

function anchorFrame(anchor: Anchor): { x: number; y: number; width: number; align: "left" | "center" | "right" } {
  const centred = anchor[1] === "c";
  const width = centred ? CENTER_WIDTH : BLOCK_WIDTH;
  const x = anchor[1] === "l" ? 64 : centred ? (1000 - CENTER_WIDTH) / 2 : 1000 - 64 - BLOCK_WIDTH;
  const y = anchor[0] === "t" ? 108 : anchor[0] === "m" ? (562.5 - BLOCK_H) / 2 : 562.5 - 56 - BLOCK_H;
  const align = anchor[1] === "l" ? "left" : centred ? "center" : "right";
  return { x, y, width, align };
}

/**
 * The three-voice text block. `onImage` adds the translucent glass panel the
 * brief asks for, so type stays readable over a full-bleed render.
 */
function block(anchor: Anchor, colors: { eyebrow: ColorRole; title: ColorRole; body: ColorRole }, onImage: boolean): Slot[] {
  const { x, y, width, align } = anchorFrame(anchor);
  const slots: Slot[] = [];
  if (onImage) {
    slots.push(shape([x - 28, y - 24, width + 56, BLOCK_H + 44], "contrast", { round: PANEL_RADIUS, opacity: 0.52, outline: "surface", outlineWidth: 1, z: 3 }));
  }
  slots.push(
    txt("subtitle", [x, y, width, EYEBROW_H], "heading", colors.eyebrow, { family: "script", align, fit: { maxLines: 1, minFont: 20 }, z: 6 }),
    txt("title", [x, y + EYEBROW_H, width, TITLE_H], "display", colors.title, { family: "display", weight: 700, align, transform: "upper", letterSpacing: -0.5, fit: { maxLines: 3, minFont: 30 }, z: 6 }),
    txt("bullets", [x, y + EYEBROW_H + TITLE_H, width, BODY_H], "caption", colors.body, { family: "body", weight: 700, align, fit: { maxItems: 4, maxChars: 96, minFont: 12 }, z: 6 }),
  );
  return slots;
}

const onImageColors = { eyebrow: "accent" as ColorRole, title: "textOnContrast" as ColorRole, body: "secondary" as ColorRole };
const onGroundColors = { eyebrow: "accent" as ColorRole, title: "textOnPrimary" as ColorRole, body: "secondary" as ColorRole };

/** Nine compositions; the slide's position picks one, so no two neighbours match. */
const NINE: Anchor[] = ["tl", "bc", "mr", "tc", "bl", "ml", "br", "tr", "mc"];

function imageBacked(anchor: Anchor): LayoutRecipe {
  return {
    background: "contrast",
    slots: [
      ...frame("contrast", "surfaceAlt"),
      img([...CARD] as unknown as [number, number, number, number], { radius: CARD_RADIUS, z: 2 }),
      // Without a render the card keeps the palette ground — a deliberate
      // composition rather than an empty frame.
      shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, when: "noImage", z: 2 }),
      ...header(),
      ...block(anchor, onImageColors, true),
    ],
  };
}

function groundBacked(anchor: Anchor): LayoutRecipe {
  return {
    background: "contrast",
    slots: [
      ...frame("contrast", "primary"),
      shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", gradientAngle: 155, z: 1 }),
      ...header(),
      ...block(anchor, onGroundColors, false),
    ],
  };
}

export const klassik: SlideTemplate = {
  code: "klassik",
  name: "Klassik",
  style: "super_professional",
  tagline: "Uch xil shrift, to'qqiz joylashuv va 3D shisha fon",
  sortOrder: 5,
  previewLayout: "cover",
  artDirection: {
    imageStyle:
      "3D glassmorphism hero object: transparent crystal glass with translucent coloured acrylic, iridescent light refraction, rounded beveled edges, glossy polished surface, soft studio lighting, object floating above a reflective surface, premium minimal fintech aesthetic, dark cinematic backdrop with a warm glow, the object fills the frame and reads clearly at a glance, very few elements",
    illustrationStyle: "premium 3D glass and crystal render, one hero object, cinematic studio lighting",
    mood: "premium, cinematic, confident",
    decorativeElements: ["rounded slide card", "translucent glass panels", "author header row", "domain pill"],
    chartStyle: "glass-panel charts with a single accent series",
    spacingStyle: "one large type block anchored to one of nine positions",
    typography: { display: "League Spartan", body: "Arimo" },
    imagePolicy: "contextual",
  },
  blueprint: {
    type: { ...defaultScale, mega: 118, display: 58, title: 40, heading: 30, body: 20, caption: 16, micro: 12 },
    radius: { card: PANEL_RADIUS, image: CARD_RADIUS },
    fonts: {
      script: "PinyonScript_400Regular",
      display: "LeagueSpartan_800ExtraBold",
      body: "Arimo_700Bold",
    },
    // Every undeclared layout still rotates through the nine placements.
    fallback: NINE.map(imageBacked),
    layouts: {
      // The opener always gets the render, set as large as the grid allows.
      cover: {
        background: "contrast",
        slots: [
          ...frame("contrast", "surfaceAlt"),
          img([...CARD] as unknown as [number, number, number, number], { radius: CARD_RADIUS, z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", when: "noImage", z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "contrast", { round: CARD_RADIUS, opacity: 0.46, when: "hasImage", z: 3 }),
          ...header(),
          txt("subtitle", [64, 118, 620, 50], "title", "accent", { family: "script", fit: { maxLines: 1, minFont: 24 }, z: 6 }),
          txt("title", [64, 176, 700, 210], "mega", "textOnContrast", { family: "display", weight: 700, transform: "upper", letterSpacing: -1.5, fit: { maxLines: 3, minFont: 44 }, z: 6 }),
          rule(66, 404, 96, "accent", 6, 6),
          txt("bullets", [64, 430, 560, 84], "caption", "secondary", { family: "body", weight: 700, fit: { maxItems: 2, maxChars: 92, minFont: 13 }, z: 6 }),
        ],
      },
      // Second slide is always the palette ground — the brief's requirement.
      agenda: groundBacked("tl"),
      title_body: NINE.map(imageBacked),
      two_columns: NINE.map(groundBacked),
      comparison: NINE.map(groundBacked),
      timeline: NINE.map(groundBacked),
      statistic: {
        background: "contrast",
        slots: [
          ...frame("contrast", "surfaceAlt"),
          img([...CARD] as unknown as [number, number, number, number], { radius: CARD_RADIUS, z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", when: "noImage", z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "contrast", { round: CARD_RADIUS, opacity: 0.5, when: "hasImage", z: 3 }),
          ...header(),
          txt("subtitle", [64, 116, 560, 46], "heading", "accent", { family: "script", fit: { maxLines: 1, minFont: 20 }, z: 6 }),
          txt("statValue", [64, 168, 700, 150], "mega", "textOnContrast", { family: "display", weight: 700, letterSpacing: -2, fit: { maxLines: 1, minFont: 54 }, z: 6 }),
          rule(66, 336, 88, "accent", 6, 6),
          txt("statLabel", [64, 362, 520, 90], "caption", "secondary", { family: "body", weight: 700, fit: { maxLines: 3, minFont: 13 }, z: 6 }),
          txt("title", [64, 466, 560, 44], "caption", "textOnContrast", { family: "body", weight: 700, fit: { maxLines: 2, minFont: 12 }, z: 6 }),
        ],
      },
      quote: {
        background: "contrast",
        slots: [
          ...frame("contrast", "surfaceAlt"),
          img([...CARD] as unknown as [number, number, number, number], { radius: CARD_RADIUS, z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", when: "noImage", z: 2 }),
          shape([...CARD] as unknown as [number, number, number, number], "contrast", { round: CARD_RADIUS, opacity: 0.58, when: "hasImage", z: 3 }),
          ...header(),
          shape([150, 150, 700, 264], "contrast", { round: PANEL_RADIUS, opacity: 0.5, outline: "surface", outlineWidth: 1, z: 4 }),
          txt("quoteText", [186, 186, 628, 152], "title", "textOnContrast", { family: "display", weight: 700, align: "center", fit: { maxLines: 4, minFont: 22 }, z: 6 }),
          txt("quoteAttribution", [186, 348, 628, 40], "caption", "accent", { family: "script", align: "center", fit: { maxLines: 1, minFont: 16 }, z: 6 }),
        ],
      },
      chart: {
        background: "contrast",
        slots: [
          ...frame("contrast", "primary"),
          shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", gradientAngle: 155, z: 1 }),
          ...header(),
          txt("subtitle", [64, 110, 500, 42], "heading", "accent", { family: "script", fit: { maxLines: 1, minFont: 18 }, z: 6 }),
          txt("title", [64, 156, 500, 92], "title", "textOnPrimary", { family: "display", weight: 700, transform: "upper", fit: { maxLines: 2, minFont: 22 }, z: 6 }),
          txt("bullets", [64, 264, 420, 214], "caption", "secondary", { family: "body", weight: 700, fit: { maxItems: 4, maxChars: 88, minFont: 12 }, z: 6 }),
          shape([540, 130, 396, 356], "contrast", { round: PANEL_RADIUS, opacity: 0.42, outline: "surface", outlineWidth: 1, z: 3 }),
          chart([578, 168, 320, 280], "donut", "accent", { trackColor: "contrast", labelColor: "secondary", z: 6 }),
        ],
      },
      conclusion: groundBacked("mc"),
      references: {
        background: "contrast",
        slots: [
          ...frame("contrast", "primary"),
          shape([...CARD] as unknown as [number, number, number, number], "primary", { round: CARD_RADIUS, gradientTo: "contrast", gradientAngle: 155, z: 1 }),
          ...header(),
          txt("subtitle", [64, 110, 620, 42], "heading", "accent", { family: "script", literal: "Foydalanilgan manbalar", fit: { maxLines: 1, minFont: 18 }, z: 6 }),
          txt("sources", [64, 168, 872, 320], "caption", "textOnPrimary", { family: "body", fit: { maxItems: 10, maxChars: 120, minFont: 12 }, z: 6 }),
        ],
      },
    },
  },
};
