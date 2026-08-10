import type { SlideTemplate } from "../design-types.ts";
import { bleed, chart, circle, defaultScale, img, rule, scaffold, shape, txt } from "./kit.ts";

/** JURNAL MUQOVASI — magazine cover logic: full image, overlaid masthead type. */
export const jurnalMuqovasi: SlideTemplate = {
  code: "jurnal_muqovasi",
  name: "Jurnal muqovasi",
  style: "great",
  tagline: "Jurnal muqovasi ritmi va ustma-ust tushgan sarlavhalar",
  sortOrder: 1,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "editorial illustration with a single strong subject and clean background, magazine cover composition",
    illustrationStyle: "flat editorial illustration with textured shading",
    mood: "editorial, curious, warm",
    decorativeElements: ["masthead rules", "column dividers", "drop caps"],
    chartStyle: "print-like charts with hairline axes",
    spacingStyle: "editorial columns",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 58, title: 36 },
    radius: { card: 12, image: 12 },
    fallback: {
      slots: [
        rule(64, 122, 872, "contrast", 3, 3),
        txt("title", [64, 62, 872, 56], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
        txt("bullets", [64, 156, 424, 330], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
        txt("body", [524, 156, 412, 330], "caption", "textSecondary", { fit: { maxItems: 5, maxChars: 150, minFont: 13 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          img([0, 0, 1000, 562.5], { radius: 0, z: 0 }),
          shape([0, 0, 1000, 562.5], "secondary", { round: 0, when: "noImage", z: 0 }),
          shape([0, 0, 1000, 118], "surface", { round: 0, opacity: 0.95, z: 2 }),
          rule(0, 118, 1000, "accent", 6, 3),
          txt("brand", [64, 44, 500, 34], "heading", "textPrimary", { weight: 700, letterSpacing: 4, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          shape([64, 306, 620, 196], "surface", { round: 12, opacity: 0.94, z: 3 }),
          txt("title", [96, 336, 556, 108], "display", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 30 }, z: 5 }),
          txt("subtitle", [96, 452, 556, 34], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          rule(64, 122, 872, "contrast", 3, 3),
          txt("title", [64, 62, 872, 56], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
          txt("statValue", [64, 160, 430, 150], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 46 }, z: 5 }),
          txt("statLabel", [64, 328, 400, 140], "body", "textSecondary", { fit: { maxLines: 5 }, z: 5 }),
          shape([524, 160, 412, 310], "surfaceAlt", { round: 12, z: 1 }),
          txt("bullets", [560, 194, 340, 242], "caption", "textPrimary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("surfaceAlt"),
          txt("quoteText", [120, 148, 760, 220], "display", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 4, minFont: 26 }, z: 5 }),
          rule(452, 396, 96, "accent", 4, 4),
          txt("quoteAttribution", [120, 420, 760, 40], "caption", "textSecondary", { align: "center", fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          rule(64, 122, 872, "contrast", 3, 3),
          txt("title", [64, 62, 872, 56], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
          img([560, 152, 376, 330], { radius: 12, z: 3 }),
          shape([560, 152, 376, 330], "secondary", { round: 12, when: "noImage", z: 2 }),
          txt("bullets", [64, 156, 448, 326], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 140, minFont: 15 }, grow: true, z: 5 }),
        ],
      },
      chart: {
        slots: [
          rule(64, 122, 872, "contrast", 3, 3),
          txt("title", [64, 62, 872, 56], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
          chart([64, 160, 540, 310], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          txt("bullets", [648, 172, 288, 292], "caption", "textSecondary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** ILLYUSTRATSIYA SAHNA — a centred stage for one illustration with caption. */
export const illyustratsiyaSahna: SlideTemplate = {
  code: "illyustratsiya_sahna",
  name: "Illyustratsiya sahna",
  style: "great",
  tagline: "Markazlashgan illyustratsiya sahnasi va tinch izohlar",
  sortOrder: 2,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "centred illustrative scene with a clear focal subject, soft ambient shadow, plenty of breathing room around the subject",
    illustrationStyle: "warm narrative illustration, rounded forms",
    mood: "friendly, explanatory, warm",
    decorativeElements: ["stage arcs", "soft shadows", "rounded platforms"],
    chartStyle: "friendly rounded charts",
    spacingStyle: "centred with symmetric breathing room",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 50, title: 34 },
    radius: { card: 28, image: 28 },
    fallback: {
      slots: [
        bleed("background"),
        circle(340, 92, 320, "secondary", { opacity: 0.5, z: 0 }),
        txt("title", [140, 78, 720, 76], "title", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 2, minFont: 24 } }),
        shape([140, 186, 720, 300], "surface", { round: 28, shadow: true, z: 1 }),
        txt("bullets", [186, 222, 628, 232], "body", "textPrimary", { align: "center", fit: { maxItems: 4, maxChars: 130, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          circle(300, 40, 400, "secondary", { opacity: 0.55, z: 0 }),
          circle(410, 150, 180, "accent", { opacity: 0.4, z: 1 }),
          txt("brand", [140, 84, 720, 22], "micro", "primary", { weight: 600, align: "center", letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [130, 178, 740, 170], "display", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 3, minFont: 30 }, z: 5 }),
          txt("subtitle", [180, 372, 640, 56], "body", "textSecondary", { align: "center", when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          circle(700, 300, 340, "secondary", { opacity: 0.42, z: 0 }),
          txt("title", [72, 74, 400, 120], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          txt("bullets", [72, 216, 400, 268], "body", "textSecondary", { fit: { maxItems: 5, maxChars: 130, minFont: 15 }, grow: true, z: 5 }),
          shape([524, 82, 404, 400], "surface", { round: 28, shadow: true, z: 1 }),
          img([560, 118, 332, 328], { radius: 24, z: 3 }),
          circle(646, 204, 160, "accent", { opacity: 0.5, when: "noImage", z: 3 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          shape([140, 96, 720, 380], "surface", { round: 28, shadow: true, z: 1 }),
          txt("title", [186, 134, 628, 54], "heading", "textSecondary", { weight: 600, align: "center", fit: { maxLines: 1 } }),
          txt("statValue", [186, 194, 628, 130], "mega", "primary", { weight: 700, align: "center", fit: { maxLines: 1, minFont: 46 }, z: 5 }),
          txt("statLabel", [216, 342, 568, 100], "body", "textSecondary", { align: "center", fit: { maxLines: 3 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("secondary"),
          circle(-100, -100, 320, "accent", { opacity: 0.4, z: 0 }),
          txt("quoteText", [150, 156, 700, 210], "title", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 5, minFont: 22 }, z: 5 }),
          txt("quoteAttribution", [150, 400, 700, 42], "caption", "textSecondary", { align: "center", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [140, 68, 720, 68], "title", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 2, minFont: 24 } }),
          shape([140, 158, 720, 336], "surface", { round: 28, shadow: true, z: 1 }),
          chart([196, 196, 400, 260], "donut", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          txt("bullets", [634, 202, 190, 248], "caption", "textSecondary", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** GRADIENT TO'LQIN — flowing gradient grounds with light type. */
export const gradientTolqin: SlideTemplate = {
  code: "gradient_tolqin",
  name: "Gradient to'lqin",
  style: "great",
  tagline: "Oqar gradientlar va yengil, havodor tipografika",
  sortOrder: 3,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "abstract flowing gradient artwork with smooth colour transitions and a soft focal glow, no hard edges",
    illustrationStyle: "abstract gradient forms and soft blurred shapes",
    mood: "modern, energetic, optimistic",
    decorativeElements: ["gradient blobs", "soft glows", "long flowing curves"],
    chartStyle: "gradient-filled charts",
    spacingStyle: "airy with diagonal movement",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 56, title: 36 },
    radius: { card: 26, image: 26 },
    fallback: {
      slots: [
        bleed("background"),
        shape([-140, 300, 620, 400], "primary", { round: "full", gradientTo: "accent", opacity: 0.25, z: 0 }),
        txt("title", [72, 70, 856, 84], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
        shape([72, 190, 856, 300], "surface", { round: 26, opacity: 0.9, shadow: true, z: 1 }),
        txt("bullets", [116, 226, 768, 228], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          shape([0, 0, 1000, 562.5], "primary", { round: 0, gradientTo: "accent", gradientAngle: 135, z: 0 }),
          circle(640, -120, 460, "surface", { opacity: 0.16, z: 1 }),
          circle(760, 260, 320, "surface", { opacity: 0.12, z: 1 }),
          txt("brand", [72, 70, 400, 24], "micro", "textOnPrimary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [72, 168, 600, 190], "display", "textOnPrimary", { weight: 700, fit: { maxLines: 3, minFont: 32 }, z: 5 }),
          txt("subtitle", [72, 388, 520, 58], "body", "textOnPrimary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "primary",
      },
      statistic: {
        slots: [
          bleed("background"),
          shape([540, -80, 560, 500], "primary", { round: "full", gradientTo: "accent", opacity: 0.3, z: 0 }),
          txt("title", [72, 66, 600, 66], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          txt("statValue", [72, 152, 520, 146], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 46 }, z: 5 }),
          txt("statLabel", [72, 320, 440, 130], "body", "textSecondary", { fit: { maxLines: 4 }, z: 5 }),
          shape([604, 158, 324, 296], "surface", { round: 26, opacity: 0.92, shadow: true, z: 2 }),
          txt("bullets", [640, 194, 252, 224], "caption", "textPrimary", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          shape([0, 0, 1000, 562.5], "accent", { round: 0, gradientTo: "primary", gradientAngle: 200, z: 0 }),
          txt("quoteText", [120, 154, 760, 216], "title", "textOnPrimary", { weight: 700, align: "center", fit: { maxLines: 5, minFont: 24 }, z: 5 }),
          txt("quoteAttribution", [120, 400, 760, 42], "caption", "textOnPrimary", { align: "center", fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "primary",
      },
      title_body: {
        slots: [
          bleed("background"),
          shape([-160, 260, 560, 420], "primary", { round: "full", gradientTo: "accent", opacity: 0.22, z: 0 }),
          txt("title", [72, 72, 420, 118], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          txt("bullets", [72, 212, 420, 274], "body", "textSecondary", { fit: { maxItems: 5, maxChars: 130, minFont: 15 }, grow: true, z: 5 }),
          img([540, 62, 388, 438], { radius: 26, z: 3 }),
          shape([540, 62, 388, 438], "primary", { round: 26, gradientTo: "accent", opacity: 0.5, when: "noImage", z: 2 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [72, 64, 856, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([72, 164, 540, 328], "surface", { round: 26, shadow: true, z: 1 }),
          chart([112, 200, 460, 256], "line", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([644, 164, 284, 328], "primary", { round: 26, gradientTo: "accent", z: 1 }),
          txt("bullets", [678, 200, 216, 256], "caption", "textOnPrimary", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** KOLLAJ HIKOYA — overlapping cards arranged like a collage. */
export const kollajHikoya: SlideTemplate = {
  code: "kollaj_hikoya",
  name: "Kollaj hikoya",
  style: "great",
  tagline: "Ustma-ust tushgan kartalar va kollaj kompozitsiya",
  sortOrder: 4,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "cut-out collage element with visible paper edge, isolated subject suitable for layering over cards",
    illustrationStyle: "paper cut-out collage with layered depth",
    mood: "playful, crafted, tactile",
    decorativeElements: ["overlapping cards", "rotated tiles", "torn paper edges"],
    chartStyle: "charts inside tilted cards",
    spacingStyle: "layered and overlapping",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 52, title: 34 },
    radius: { card: 20, image: 20 },
    fallback: {
      slots: [
        bleed("background"),
        shape([56, 140, 560, 340], "secondary", { round: 20, z: 1 }),
        shape([120, 190, 560, 300], "surface", { round: 20, shadow: true, z: 2 }),
        txt("title", [72, 62, 856, 62], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
        txt("bullets", [160, 226, 484, 228], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 130, minFont: 15 }, z: 5 }),
        shape([700, 250, 240, 240], "accent", { round: 20, opacity: 0.65, z: 1 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          shape([60, 120, 520, 380], "accent", { round: 20, opacity: 0.7, z: 1 }),
          shape([140, 168, 520, 330], "surface", { round: 20, shadow: true, z: 2 }),
          shape([620, 60, 320, 300], "secondary", { round: 20, z: 1 }),
          img([640, 80, 280, 260], { radius: 16, z: 3 }),
          txt("brand", [72, 64, 400, 24], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [180, 208, 444, 168], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 28 }, z: 5 }),
          txt("subtitle", [180, 398, 444, 52], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          shape([64, 130, 420, 330], "secondary", { round: 20, z: 1 }),
          shape([116, 168, 420, 300], "surface", { round: 20, shadow: true, z: 2 }),
          txt("title", [72, 62, 856, 56], "heading", "textSecondary", { weight: 600, fit: { maxLines: 1 } }),
          txt("statValue", [152, 206, 350, 130], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 44 }, z: 5 }),
          txt("statLabel", [152, 350, 350, 96], "caption", "textSecondary", { fit: { maxLines: 3 }, z: 5 }),
          shape([580, 150, 360, 320], "accent", { round: 20, z: 1 }),
          txt("bullets", [616, 186, 288, 250], "body", "textOnAccent", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("secondary"),
          shape([110, 130, 780, 300], "surface", { round: 20, shadow: true, z: 2 }),
          shape([150, 170, 780, 300], "accent", { round: 20, opacity: 0.35, z: 1 }),
          txt("quoteText", [156, 172, 690, 200], "title", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 22 }, z: 5 }),
          txt("quoteAttribution", [156, 384, 600, 40], "caption", "textSecondary", { fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          shape([48, 150, 460, 330], "accent", { round: 20, opacity: 0.6, z: 1 }),
          shape([100, 190, 460, 300], "surface", { round: 20, shadow: true, z: 2 }),
          txt("title", [72, 60, 600, 106], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          txt("bullets", [140, 226, 384, 232], "caption", "textPrimary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, z: 5 }),
          shape([588, 118, 356, 344], "secondary", { round: 20, z: 1 }),
          img([610, 140, 312, 300], { radius: 16, z: 3 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [72, 60, 856, 62], "title", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 24 } }),
          shape([56, 150, 520, 330], "secondary", { round: 20, z: 1 }),
          shape([104, 186, 520, 300], "surface", { round: 20, shadow: true, z: 2 }),
          chart([140, 214, 452, 244], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([664, 168, 280, 300], "accent", { round: 20, z: 1 }),
          txt("bullets", [696, 204, 216, 228], "caption", "textOnAccent", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

jurnalMuqovasi.blueprint.layouts = {
  ...scaffold({
    margin: 64, card: null, cardRadius: 12, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [rule(64, 122, 872, "contrast", 3, 3)]),
  }),
  ...jurnalMuqovasi.blueprint.layouts,
};

illyustratsiyaSahna.blueprint.layouts = {
  ...scaffold({
    margin: 100, card: "surface", cardRadius: 28, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background"), circle(660, 320, 340, "secondary", { opacity: 0.4, z: 0 })]),
  }),
  ...illyustratsiyaSahna.blueprint.layouts,
};

gradientTolqin.blueprint.layouts = {
  ...scaffold({
    margin: 72, card: "surface", cardRadius: 26, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast"
      ? [shape([0, 0, 1000, 562.5], "contrast", { round: 0, gradientTo: "primary", z: 0 })]
      : [bleed("background"), shape([-150, 320, 560, 420], "primary", { round: "full", gradientTo: "accent", opacity: 0.2, z: 0 })]),
  }),
  ...gradientTolqin.blueprint.layouts,
};

kollajHikoya.blueprint.layouts = {
  ...scaffold({
    margin: 72, card: "surface", cardRadius: 20, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background"), shape([700, 330, 300, 260], "accent", { round: 20, opacity: 0.45, z: 0 })]),
  }),
  ...kollajHikoya.blueprint.layouts,
};

export const greatTemplates = [jurnalMuqovasi, illyustratsiyaSahna, gradientTolqin, kollajHikoya];
