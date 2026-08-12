import type { ColorRole, LayoutRecipe, Slot, SlideTemplate } from "../design-types.ts";
import { bleed, chart, circle, img, shape, txt } from "./kit.ts";

/**
 * TOZA OSMON — built to the written brief.
 *
 * The design is a bright open sky with an editorial poster laid over it. Three
 * things make it recognisable, and every layout below keeps all three:
 *
 *   1. The type pairing. A lime handwritten accent word sits against an ultra-bold
 *      black headline, the two overlapping slightly. That contrast — loose script
 *      against tight grotesque, acid yellow against black — is the whole identity.
 *   2. Photographs are printed objects, not image boxes: a white border, a soft
 *      shadow, and a few degrees of rotation, as if placed on the page by hand.
 *   3. Air. Most slides are mostly empty, and the clouds live at the edges where
 *      they never cross the words.
 *
 * Two implementation notes worth knowing before reading the layouts.
 *
 * **Rotation.** The slot vocabulary has no rotation, so a tilted polaroid is
 * built as a stack of frames, each inset and offset a little from the last. It
 * reads as a hand-placed print at a glance, and it costs nothing the renderer
 * cannot already do. Where the brief asks for -4° or +3°, the offset direction
 * encodes the lean.
 *
 * **Overlap.** The lime accent is placed to hang over the black headline by a
 * tenth of its own height, which is the 5–15% the brief asks for. The accent is
 * drawn *above* the headline in z-order so the handwriting reads as written on
 * top, and the headline keeps its own frame so it never reflows around the accent.
 *
 * The brief describes eleven compositions. The pipeline addresses slides by
 * `LayoutName`, of which there are twelve, so the eleven are mapped onto those
 * names and the busiest names carry several variants that the engine rotates by
 * slide position — which is also what stops the same composition appearing twice
 * in a row.
 */

/* ------------------------------------------------------------------ ground -- */

/**
 * Sky plus clouds. Never a flat fill: the brief is explicit that the ground must
 * read as air, so the base colour carries a soft vertical lift and the clouds are
 * low-opacity white forms clustered at the left and bottom edges.
 *
 * `density` decides how much weather a slide gets. Statement slides take `light`
 * so nothing competes with the words.
 */
function sky(density: "light" | "full" = "full"): Slot[] {
  const clouds: Slot[] = [
    // Upper-left drift.
    circle(-90, -70, 260, "surface", { opacity: 0.5, z: 1 }),
    circle(30, -110, 220, "surface", { opacity: 0.34, z: 1 }),
    // Lower-left bank, the heaviest cluster in the reference.
    circle(-120, 380, 320, "surface", { opacity: 0.46, z: 1 }),
    circle(60, 452, 240, "surface", { opacity: 0.36, z: 1 }),
    circle(190, 500, 180, "surface", { opacity: 0.26, z: 1 }),
  ];
  const extra: Slot[] = [
    // Right-hand haze, thin enough to stay behind a photograph.
    circle(880, 430, 260, "surface", { opacity: 0.22, z: 1 }),
    circle(760, 40, 150, "surface", { opacity: 0.16, z: 1 }),
  ];
  return [
    bleed("background"),
    // The lift: a lighter wash over the top two-thirds so the ground has depth.
    shape([0, 0, 1000, 380], "surfaceAlt", { round: 0, opacity: 0.34, z: 0 }),
    ...(density === "full" ? [...clouds, ...extra] : clouds.slice(0, 3)),
  ];
}

/* ------------------------------------------------------------------ chrome -- */

/**
 * The micro header. Small enough that it never competes with the headline, and
 * present on every content slide so the deck reads as one publication.
 */
function microHeader(): Slot[] {
  return [
    txt("sectionLabel", [58, 34, 420, 18], "micro", "textPrimary", {
      family: "body", weight: 700, transform: "upper", letterSpacing: 1.2,
      fit: { maxLines: 1, minFont: 9 }, z: 8,
    }),
    txt("pageNumber", [640, 34, 302, 18], "micro", "textPrimary", {
      family: "body", weight: 700, align: "right", transform: "upper", letterSpacing: 1.2,
      fit: { maxLines: 1, minFont: 9 }, z: 8,
    }),
  ];
}

/* ------------------------------------------------------------- typography -- */

type TitleBlock = {
  x: number;
  y: number;
  width: number;
  align?: "left" | "center" | "right";
  /** Headline height. The accent is sized from it. */
  titleHeight?: number;
  accentHeight?: number;
  /** Lines the headline may take before it shrinks. */
  maxLines?: number;
  minFont?: number;
};

/**
 * The signature pairing: lime handwritten accent above an ultra-bold black
 * headline, overlapping by a tenth of the accent's height.
 *
 * The accent is bound to `subtitle` and the headline to `title`, so a writer who
 * supplies only a title still gets a correct slide — the accent simply does not
 * render, and the headline keeps its place rather than jumping upward.
 */
function titleGroup(block: TitleBlock): Slot[] {
  const {
    x, y, width, align = "left",
    titleHeight = 150, accentHeight = 74, maxLines = 3, minFont = 30,
  } = block;
  // A tenth of the accent's height, which lands inside the brief's 5–15%.
  const overlap = Math.round(accentHeight * 0.1);
  return [
    txt("title", [x, y + accentHeight - overlap, width, titleHeight], "mega", "textPrimary", {
      family: "display", weight: 700, align, transform: "upper",
      letterSpacing: -1.4, fit: { maxLines, minFont }, z: 5,
    }),
    // Drawn above the headline: the handwriting reads as written on top of it.
    txt("subtitle", [x, y, width, accentHeight], "display", "accent", {
      family: "script", align, transform: "upper",
      fit: { maxLines: 1, minFont: 26 }, z: 7,
    }),
  ];
}

/* ----------------------------------------------------------------- photos -- */

/**
 * A printed photograph: white border, soft shadow, and a lean built from stacked
 * offsets because the slot vocabulary has no rotation.
 *
 * `lean` is the direction and rough degree the brief calls for. Negative leans
 * left. The bottom border is deliberately deeper than the sides, the way a real
 * print is.
 */
function polaroid(frame: readonly [number, number, number, number], lean: -4 | -3 | -2 | 2 | 3 | 4, z = 4): Slot[] {
  const [x, y, w, h] = frame;
  const tilt = lean / 2;
  const border = 14;
  const bottomBorder = 26;
  return [
    // Shadow: large blur is not available, so a wide low-opacity offset stands in.
    shape([x + 6 + tilt, y + 10, w, h], "contrast", { round: 4, opacity: 0.1, z: z - 1 }),
    // The print itself, leaning: the paper is offset one way, the image the other.
    shape([x + tilt, y, w, h], "surface", { round: 3, z }),
    { kind: "image", role: "image", when: "hasImage", z: z + 1,
      frame: [x + border - tilt / 2, y + border, w - border * 2, h - border - bottomBorder] },
  ];
}

/** A lime marker with its ordinal, for the numbered lists the brief describes. */
function marker(x: number, y: number, label: string, z = 6): Slot[] {
  return [
    circle(x, y, 46, "accent", { z }),
    txt("sectionLabel", [x, y + 13, 46, 22], "caption", "textPrimary", {
      family: "display", weight: 700, align: "center", literal: label,
      fit: { maxLines: 1, minFont: 12 }, z: z + 1,
    }),
  ];
}

/** A hand-drawn underline: a short lime stroke that leans, sitting under a word. */
function underline(x: number, y: number, width: number, z = 6): Slot[] {
  return [
    shape([x, y, width, 9], "accent", { round: "full", z }),
    shape([x + width - 18, y - 3, 26, 9], "accent", { round: "full", opacity: 0.75, z }),
  ];
}

/* ---------------------------------------------------------------- layouts -- */

/** 01 — HERO COVER. Sky, one centred title group, a credit line, nothing else. */
const cover: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    ...titleGroup({ x: 220, y: 176, width: 560, align: "center", titleHeight: 172, accentHeight: 82, maxLines: 2, minFont: 44 }),
    txt("brand", [220, 452, 560, 26], "caption", "textPrimary", {
      family: "body", weight: 700, align: "center", transform: "upper", letterSpacing: 1.6,
      fit: { maxLines: 1, minFont: 11 }, z: 6,
    }),
    txt("body", [260, 482, 480, 22], "micro", "textSecondary", {
      family: "body", align: "center", fit: { maxLines: 1, minFont: 9 }, z: 6,
    }),
  ],
};

/** 02 — WELCOME + PHOTO. Title and intro left, one leaning print right. */
const titleWithPhoto: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    ...titleGroup({ x: 66, y: 124, width: 440, titleHeight: 156, accentHeight: 76, maxLines: 2, minFont: 40 }),
    txt("body", [66, 372, 400, 108], "caption", "textSecondary", {
      family: "body", fit: { maxLines: 4, minFont: 12 }, z: 6,
    }),
    ...polaroid([596, 82, 300, 330], 4),
  ],
};

/** 03 — CENTERED STATEMENT. No photograph; the words carry it. */
const statement: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    txt("sectionLabel", [280, 116, 440, 20], "micro", "textPrimary", {
      family: "body", weight: 700, align: "center", transform: "upper", letterSpacing: 2,
      fit: { maxLines: 1, minFont: 9 }, z: 6,
    }),
    ...titleGroup({ x: 200, y: 162, width: 600, align: "center", titleHeight: 168, accentHeight: 80, maxLines: 2, minFont: 42 }),
    txt("body", [250, 424, 500, 76], "caption", "textSecondary", {
      family: "body", align: "center", fit: { maxLines: 3, minFont: 12 }, z: 6,
    }),
  ],
};

/** 04 — THREE POINTS. Title above, three marked columns on one baseline. */
const threePoints: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    ...titleGroup({ x: 250, y: 84, width: 500, align: "center", titleHeight: 108, accentHeight: 62, maxLines: 2, minFont: 34 }),
    ...marker(96, 288, "01"),
    ...marker(452, 288, "02"),
    ...marker(808, 288, "03"),
    txt("bullets", [66, 356, 250, 150], "caption", "textPrimary", {
      family: "body", weight: 700, fit: { maxItems: 3, maxChars: 110, minFont: 12 }, z: 6,
    }),
    txt("body", [422, 356, 250, 150], "caption", "textSecondary", {
      family: "body", when: "hasBody", fit: { maxLines: 5, minFont: 12 }, z: 6,
    }),
  ],
};

/** 05 — TEXT BETWEEN TWO PHOTOS. Prints lean into the edges; the centre stays clear. */
const betweenPhotos: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    ...polaroid([-38, 128, 228, 262], -4),
    ...polaroid([812, 196, 226, 258], 3),
    ...titleGroup({ x: 260, y: 122, width: 480, align: "center", titleHeight: 176, accentHeight: 72, maxLines: 3, minFont: 34 }),
    txt("body", [286, 400, 428, 90], "caption", "textSecondary", {
      family: "body", align: "center", fit: { maxLines: 3, minFont: 12 }, z: 6,
    }),
  ],
};

/** 06 — FOUNDATION LIST. One large print left, title and a marked list right. */
const foundationList: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    ...polaroid([78, 92, 330, 366], -3),
    ...titleGroup({ x: 556, y: 104, width: 386, titleHeight: 136, accentHeight: 68, maxLines: 3, minFont: 32 }),
    circle(556, 322, 12, "accent", { z: 6 }),
    circle(556, 366, 12, "accent", { z: 6 }),
    circle(556, 410, 12, "accent", { z: 6 }),
    circle(556, 454, 12, "accent", { z: 6 }),
    txt("bullets", [586, 312, 356, 190], "caption", "textPrimary", {
      family: "body", weight: 700, fit: { maxItems: 4, maxChars: 76, minFont: 12 }, z: 6,
    }),
  ],
};

/** 07 — POWER STATEMENT. Small note left, an enormous stacked headline right. */
const powerStatement: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    txt("body", [66, 130, 216, 168], "caption", "textSecondary", {
      family: "body", fit: { maxLines: 7, minFont: 11 }, z: 6,
    }),
    ...titleGroup({ x: 322, y: 118, width: 520, titleHeight: 300, accentHeight: 86, maxLines: 4, minFont: 40 }),
  ],
};

/** 08 — QUESTION + NOTES. Question left, prompts centre, two notes right. */
const questionNotes: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    txt("sectionLabel", [66, 108, 300, 20], "micro", "textPrimary", {
      family: "body", weight: 700, transform: "upper", letterSpacing: 2,
      fit: { maxLines: 1, minFont: 9 }, z: 6,
    }),
    txt("title", [66, 142, 274, 220], "display", "textPrimary", {
      family: "display", weight: 700, transform: "upper", letterSpacing: -1.2,
      fit: { maxLines: 3, minFont: 34 }, z: 6,
    }),
    ...marker(382, 158, "1"),
    ...marker(382, 262, "2"),
    ...marker(382, 366, "3"),
    txt("bullets", [444, 152, 254, 300], "caption", "textPrimary", {
      family: "body", weight: 700, fit: { maxItems: 3, maxChars: 92, minFont: 12 }, z: 6,
    }),
    // Two sticky notes: lime, then a warm paper tone. Never random colours.
    shape([742, 118, 196, 168], "accent", { round: 4, z: 4 }),
    shape([748, 300, 196, 164], "secondary", { round: 4, z: 4 }),
    txt("body", [762, 138, 158, 130], "micro", "textPrimary", {
      family: "body", weight: 700, when: "hasBody", fit: { maxLines: 6, minFont: 10 }, z: 6,
    }),
  ],
};

/** 09 — CLOSING THOUGHT. Centred, quiet, mostly air. */
const closing: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    txt("sectionLabel", [300, 128, 400, 20], "micro", "textPrimary", {
      family: "body", weight: 700, align: "center", transform: "upper", letterSpacing: 2,
      fit: { maxLines: 1, minFont: 9 }, z: 6,
    }),
    ...titleGroup({ x: 230, y: 176, width: 540, align: "center", titleHeight: 156, accentHeight: 78, maxLines: 2, minFont: 44 }),
    txt("body", [270, 420, 460, 76], "caption", "textSecondary", {
      family: "body", align: "center", fit: { maxLines: 3, minFont: 12 }, z: 6,
    }),
  ],
};

/** 10 — NEXT STEP. Title left, two overlapping prints upper right, a step below. */
const nextStep: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...microHeader(),
    ...titleGroup({ x: 70, y: 120, width: 372, titleHeight: 200, accentHeight: 76, maxLines: 3, minFont: 40 }),
    ...polaroid([524, 84, 224, 216], -4, 4),
    ...polaroid([712, 128, 224, 216], 4, 6),
    txt("statLabel", [524, 384, 412, 24], "caption", "textPrimary", {
      family: "display", weight: 700, transform: "upper", letterSpacing: -0.4,
      fit: { maxLines: 1, minFont: 13 }, z: 7,
    }),
    ...underline(524, 412, 128, 7),
    txt("body", [524, 430, 412, 84], "caption", "textSecondary", {
      family: "body", fit: { maxLines: 3, minFont: 11 }, z: 7,
    }),
  ],
};

/** 11 — END CARD. The largest type in the deck, and nothing else. */
const endCard: LayoutRecipe = {
  slots: [
    ...sky("full"),
    ...titleGroup({ x: 300, y: 178, width: 400, align: "center", titleHeight: 200, accentHeight: 96, maxLines: 1, minFont: 72 }),
    txt("body", [300, 452, 400, 26], "caption", "textPrimary", {
      family: "body", weight: 700, align: "center", transform: "upper", letterSpacing: 2.4,
      fit: { maxLines: 1, minFont: 11 }, z: 6,
    }),
  ],
};

/* --------------------------------------------------- utilitarian layouts -- */

/**
 * A statistic still has to look like this deck: the figure takes the headline's
 * weight and colour, and the lime marker behind it is the only decoration.
 */
const statistic: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    ...titleGroup({ x: 66, y: 112, width: 380, titleHeight: 112, accentHeight: 62, maxLines: 2, minFont: 30 }),
    circle(560, 168, 300, "accent", { opacity: 0.9, z: 3 }),
    txt("statValue", [560, 236, 300, 118], "mega", "textPrimary", {
      family: "display", weight: 700, align: "center", letterSpacing: -2,
      fit: { maxLines: 1, minFont: 46 }, z: 6,
    }),
    txt("statLabel", [560, 356, 300, 60], "caption", "textPrimary", {
      family: "body", weight: 700, align: "center", transform: "upper", letterSpacing: 1,
      fit: { maxLines: 2, minFont: 11 }, z: 6,
    }),
    txt("body", [66, 300, 400, 180], "caption", "textSecondary", {
      family: "body", fit: { maxLines: 7, minFont: 11 }, z: 6,
    }),
  ],
};

/** A quote is the power statement with attribution — the same enormous voice. */
const quote: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    txt("quoteText", [150, 132, 700, 250], "display", "textPrimary", {
      family: "display", weight: 700, align: "center", transform: "upper",
      letterSpacing: -1.2, fit: { maxLines: 4, minFont: 32 }, z: 6,
    }),
    ...underline(436, 404, 128),
    txt("quoteAttribution", [250, 428, 500, 46], "heading", "textPrimary", {
      family: "script", align: "center", fit: { maxLines: 1, minFont: 20 }, z: 6,
    }),
  ],
};

/** A chart keeps the sky and takes lime as its series colour. */
const chartSlide: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    ...titleGroup({ x: 66, y: 100, width: 360, titleHeight: 104, accentHeight: 58, maxLines: 2, minFont: 28 }),
    txt("body", [66, 288, 340, 180], "caption", "textSecondary", {
      family: "body", fit: { maxLines: 7, minFont: 11 }, z: 6,
    }),
    shape([460, 104, 480, 380], "surface", { round: 6, opacity: 0.72, z: 3 }),
    chart([496, 140, 408, 308], "bar", "accent", { trackColor: "border", labelColor: "textPrimary", z: 6 }),
  ],
};

/** References: a plain, generous list. Nothing decorative competes with a URL. */
const references: LayoutRecipe = {
  slots: [
    ...sky("light"),
    ...microHeader(),
    txt("subtitle", [66, 104, 500, 66], "display", "accent", {
      family: "script", literal: "Manbalar", fit: { maxLines: 1, minFont: 26 }, z: 7,
    }),
    txt("sources", [66, 190, 872, 300], "caption", "textPrimary", {
      family: "body", fit: { maxItems: 10, maxChars: 120, minFont: 11 }, z: 6,
    }),
  ],
};

/* ------------------------------------------------------------- the export -- */

export const tozaOsmon: SlideTemplate = {
  code: "toza_osmon",
  name: "Toza osmon",
  style: "super_professional",
  tagline: "Toza osmon, lime qo‘lyozma urg‘u va polaroid kompozitsiya",
  sortOrder: 2,
  artDirection: {
    imageStyle:
      "Bright natural editorial photograph, authentic and unposed, generous negative space around the subject, "
      + "soft daylight, airy and clean. Not cinematic, not dark, not corporate stock photography. "
      + "Leave room around the subject so a square print crop keeps its composition.",
    illustrationStyle:
      "Minimal hand-drawn marks only: a short underline, a small arrow, a circled number. "
      + "Acid lime on white or sky blue. No 3D, no gradients, no icon sets.",
    mood: "Open sky, clean, young, modern editorial. Premium without ornament.",
    decorativeElements: ["soft white clouds", "lime circular markers", "handwritten underline", "printed photo frames"],
    chartStyle: "Flat bars in acid lime on a translucent white panel. Thin grid, no shadows, no 3D.",
    spacingStyle: "8-point rhythm with large negative space and controlled asymmetry.",
    typography: {
      display: "Ultra-bold uppercase grotesque, tight tracking, line height near 0.9",
      body: "Neutral grotesque at modest size, editorial rather than presentational",
    },
    // Photographs appear where a layout asks for one; the statement slides stay
    // deliberately bare, which is why this is contextual rather than `all`.
    imagePolicy: "contextual",
  },
  blueprint: {
    // A larger mega step than any other template: the end card and the power
    // statement are meant to be the biggest type in the product.
    type: { mega: 112, display: 62, title: 40, heading: 26, body: 19, caption: 14, micro: 10 },
    radius: { card: 4, image: 3 },
    fonts: {
      // The brief named Metworkland and Helvetica Now; both are licensed and
      // neither ships with the apps. Caveat Brush and Inter are the bundled
      // faces closest to them, and naming them here rather than mapping them in
      // the renderer keeps the blueprint honest about what will actually draw.
      // See docs/toza-osmon.md.
      script: "CaveatBrush_400Regular",
      display: "Inter_900Black",
      body: "Inter_400Regular",
    },
    fallback: titleWithPhoto,
    layouts: {
      cover,
      // Two variants each where the deck is likely to spend several slides, so
      // the engine can alternate photo-heavy and type-only compositions.
      title_body: [titleWithPhoto, foundationList, statement],
      agenda: [threePoints, statement],
      two_columns: [betweenPhotos, questionNotes],
      comparison: [betweenPhotos, threePoints],
      timeline: [nextStep, foundationList],
      statistic,
      quote: [quote, powerStatement],
      chart: chartSlide,
      conclusion: [closing, powerStatement],
      references,
      thanks: endCard,
    },
  },
  previewLayout: "cover",
};
