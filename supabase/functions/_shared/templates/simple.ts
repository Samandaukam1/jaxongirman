import type { SlideTemplate } from "../design-types.ts";
import { bleed, chart, circle, defaultScale, rule, scaffold, shape, txt } from "./kit.ts";

/**
 * The `simple` tier never generates imagery, so these four templates must earn
 * their character from type, rules and colour blocks alone.
 */

/** TOZA QOG'OZ — a wide left margin, hairline rules, generous white. */
export const tozaQogoz: SlideTemplate = {
  code: "toza_qogoz",
  name: "Toza qog'oz",
  style: "simple",
  tagline: "Keng bo'sh joy, ingichka chiziqlar va sokin tipografika",
  sortOrder: 1,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "",
    illustrationStyle: "no generated imagery; typography and rules only",
    mood: "calm, academic, precise",
    decorativeElements: ["hairline rules", "wide margins", "small caps labels"],
    chartStyle: "hairline charts without fills",
    spacingStyle: "very generous, single column",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 54, title: 34, body: 20 },
    radius: { card: 0, image: 0 },
    fallback: {
      slots: [
        bleed("background"),
        txt("title", [96, 72, 808, 76], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
        rule(96, 168, 808, "border", 1, 2),
        txt("bullets", [96, 200, 700, 290], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 160, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          txt("brand", [96, 84, 400, 22], "micro", "textSecondary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          rule(96, 130, 808, "textPrimary", 2, 2),
          txt("title", [96, 176, 720, 180], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 30 }, z: 5 }),
          txt("subtitle", [96, 386, 640, 52], "body", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
          rule(96, 470, 160, "primary", 4, 2),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          txt("title", [96, 72, 808, 62], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          rule(96, 154, 808, "border", 1, 2),
          txt("statValue", [96, 186, 560, 150], "mega", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 46 }, z: 5 }),
          txt("statLabel", [96, 352, 480, 116], "body", "textSecondary", { fit: { maxLines: 4 }, z: 5 }),
          txt("bullets", [640, 196, 264, 272], "caption", "textSecondary", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("background"),
          rule(96, 148, 96, "primary", 4, 2),
          txt("quoteText", [96, 186, 740, 200], "title", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 24 }, z: 5 }),
          txt("quoteAttribution", [96, 412, 560, 40], "caption", "textSecondary", { fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [96, 72, 808, 66], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          rule(96, 156, 808, "border", 1, 2),
          chart([96, 190, 500, 288], "line", "primary", { trackColor: "border", labelColor: "textSecondary", z: 4 }),
          txt("bullets", [640, 196, 264, 274], "caption", "textSecondary", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** SHVEYS TARTIB — a visible column grid, everything aligned top-left. */
export const shveysTartib: SlideTemplate = {
  code: "shveys_tartib",
  name: "Shveys tartib",
  style: "simple",
  tagline: "Ko'rinadigan ustunlar to'ri va qat'iy chap tekislash",
  sortOrder: 2,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "",
    illustrationStyle: "no generated imagery; grid, rules and colour fields",
    mood: "rational, systematic, objective",
    decorativeElements: ["visible column grid", "grid markers", "flush-left alignment"],
    chartStyle: "grid-aligned column charts",
    spacingStyle: "strict 12-column grid",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 52, title: 32, body: 19 },
    radius: { card: 0, image: 0 },
    fallback: {
      slots: [
        bleed("background"),
        ...[0, 1, 2, 3].map((column) => rule(64 + column * 228, 56, 1, "border", 1, 0)),
        txt("title", [64, 62, 640, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
        rule(64, 156, 872, "textPrimary", 3, 2),
        txt("bullets", [64, 188, 636, 300], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          shape([64, 0, 3, 562.5], "border", { round: 0, z: 0 }),
          shape([520, 0, 3, 562.5], "border", { round: 0, z: 0 }),
          shape([936, 0, 3, 562.5], "border", { round: 0, z: 0 }),
          shape([520, 0, 416, 226], "primary", { round: 0, z: 1 }),
          txt("brand", [88, 66, 380, 22], "micro", "textSecondary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [88, 258, 412, 214], "display", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 28 }, z: 5 }),
          txt("subtitle", [544, 66, 368, 130], "body", "textOnPrimary", { when: "hasSubtitle", fit: { maxLines: 4 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          shape([64, 0, 3, 562.5], "border", { round: 0, z: 0 }),
          shape([520, 0, 3, 562.5], "border", { round: 0, z: 0 }),
          txt("sectionLabel", [88, 62, 400, 20], "micro", "primary", { weight: 600, letterSpacing: 2, transform: "upper", literal: "Mavzu", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [88, 92, 400, 120], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          rule(88, 236, 400, "textPrimary", 3, 2),
          txt("bullets", [544, 92, 392, 396], "body", "textPrimary", { fit: { maxItems: 6, maxChars: 130, minFont: 14 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          shape([520, 0, 416, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          txt("title", [88, 62, 400, 60], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          txt("statValue", [88, 150, 400, 150], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 44 }, z: 5 }),
          rule(88, 320, 120, "primary", 4, 2),
          txt("statLabel", [88, 348, 380, 120], "body", "textSecondary", { fit: { maxLines: 4 }, z: 5 }),
          txt("bullets", [544, 150, 392, 300], "caption", "textPrimary", { fit: { maxItems: 5, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("contrast"),
          shape([64, 0, 3, 562.5], "primary", { round: 0, z: 1 }),
          txt("quoteText", [110, 160, 720, 210], "title", "textOnContrast", { weight: 700, fit: { maxLines: 5, minFont: 22 }, z: 5 }),
          rule(110, 396, 96, "accent", 4, 4),
          txt("quoteAttribution", [110, 424, 560, 40], "caption", "textOnContrast", { fit: { maxLines: 1 }, z: 5 }),
        ],
        background: "contrast",
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [88, 62, 848, 66], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          rule(88, 152, 848, "textPrimary", 3, 2),
          chart([88, 186, 420, 292], "bar", "primary", { trackColor: "border", labelColor: "textSecondary", z: 4 }),
          shape([544, 186, 392, 292], "surfaceAlt", { round: 0, z: 1 }),
          txt("bullets", [576, 218, 328, 228], "caption", "textPrimary", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** QALIN KONTRAST — oversized type on alternating solid grounds. */
export const qalinKontrast: SlideTemplate = {
  code: "qalin_kontrast",
  name: "Qalin kontrast",
  style: "simple",
  tagline: "Ulkan shrift va almashinuvchi to'la rangli fonlar",
  sortOrder: 3,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "",
    illustrationStyle: "no generated imagery; oversized type and solid fields",
    mood: "bold, declarative, high-energy",
    decorativeElements: ["full-bleed colour fields", "oversized numerals", "thick bars"],
    chartStyle: "thick two-tone bars",
    spacingStyle: "tight margins, maximum type size",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, mega: 130, display: 70, title: 44, body: 21 },
    radius: { card: 0, image: 0 },
    fallback: {
      slots: [
        bleed("background"),
        txt("title", [56, 60, 888, 130], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 26 } }),
        rule(58, 208, 140, "primary", 8, 2),
        txt("bullets", [56, 246, 888, 244], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("primary"),
          txt("brand", [56, 64, 400, 24], "micro", "textOnPrimary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [56, 150, 780, 250], "display", "textOnPrimary", { weight: 700, fit: { maxLines: 3, minFont: 34 }, z: 5 }),
          rule(58, 430, 180, "accent", 10, 4),
          txt("subtitle", [56, 462, 700, 44], "caption", "textOnPrimary", { when: "hasSubtitle", fit: { maxLines: 1 }, z: 5 }),
        ],
        background: "primary",
      },
      statistic: {
        slots: [
          bleed("accent"),
          txt("title", [56, 62, 888, 58], "heading", "textOnAccent", { weight: 600, transform: "upper", letterSpacing: 2, fit: { maxLines: 1 } }),
          txt("statValue", [56, 132, 888, 200], "mega", "textOnAccent", { weight: 700, fit: { maxLines: 1, minFont: 56 }, z: 5 }),
          rule(58, 352, 160, "contrast", 8, 4),
          txt("statLabel", [56, 384, 700, 110], "body", "textOnAccent", { fit: { maxLines: 3 }, z: 5 }),
        ],
        background: "accent",
      },
      quote: {
        slots: [
          bleed("contrast"),
          txt("quoteText", [56, 130, 888, 250], "display", "textOnContrast", { weight: 700, fit: { maxLines: 4, minFont: 28 }, z: 5 }),
          rule(58, 402, 140, "accent", 8, 4),
          txt("quoteAttribution", [56, 432, 700, 44], "caption", "textOnContrast", { fit: { maxLines: 1 }, z: 5 }),
        ],
        background: "contrast",
      },
      title_body: {
        slots: [
          bleed("background"),
          shape([0, 0, 1000, 210], "primary", { round: 0, z: 0 }),
          txt("title", [56, 62, 888, 122], "title", "textOnPrimary", { weight: 700, fit: { maxLines: 2, minFont: 26 }, z: 5 }),
          txt("bullets", [56, 250, 888, 240], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, grow: true, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          shape([0, 0, 1000, 150], "contrast", { round: 0, z: 0 }),
          txt("title", [56, 52, 888, 74], "title", "textOnContrast", { weight: 700, fit: { maxLines: 1, minFont: 26 }, z: 5 }),
          chart([56, 194, 560, 288], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([656, 194, 288, 288], "accent", { round: 0, z: 1 }),
          txt("bullets", [688, 226, 224, 224], "caption", "textOnAccent", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** YUMSHOQ KARTA — rounded cards floating on a tinted ground. */
export const yumshoqKarta: SlideTemplate = {
  code: "yumshoq_karta",
  name: "Yumshoq karta",
  style: "simple",
  tagline: "Yumaloq kartalar, yumshoq soyalar va do'stona ritm",
  sortOrder: 4,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "",
    illustrationStyle: "no generated imagery; soft cards and rounded shapes",
    mood: "friendly, soft, welcoming",
    decorativeElements: ["rounded cards", "soft shadows", "pill labels"],
    chartStyle: "rounded bars inside cards",
    spacingStyle: "comfortable padding, soft rhythm",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 48, title: 32, body: 20 },
    radius: { card: 28, image: 28 },
    fallback: {
      slots: [
        bleed("surfaceAlt"),
        txt("title", [80, 66, 840, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
        shape([80, 180, 840, 310], "surface", { round: 28, shadow: true, z: 1 }),
        txt("bullets", [124, 216, 752, 238], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("surfaceAlt"),
          circle(720, 320, 300, "accent", { opacity: 0.4, z: 0 }),
          shape([80, 96, 620, 372], "surface", { round: 28, shadow: true, z: 1 }),
          shape([120, 136, 150, 34], "secondary", { round: "full", z: 2 }),
          txt("brand", [136, 144, 118, 20], "micro", "primary", { weight: 600, letterSpacing: 2, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [120, 200, 540, 160], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 28 }, z: 5 }),
          txt("subtitle", [120, 378, 520, 54], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("surfaceAlt"),
          txt("title", [80, 62, 840, 76], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([80, 176, 404, 314], "surface", { round: 28, shadow: true, z: 1 }),
          shape([516, 176, 404, 314], "surface", { round: 28, shadow: true, z: 1 }),
          txt("bullets", [116, 212, 332, 244], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
          txt("body", [552, 212, 332, 244], "body", "textSecondary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("surfaceAlt"),
          shape([80, 96, 404, 372], "surface", { round: 28, shadow: true, z: 1 }),
          shape([516, 96, 404, 372], "primary", { round: 28, z: 1 }),
          txt("title", [116, 134, 332, 56], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          txt("statValue", [116, 204, 332, 116], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 42 }, z: 5 }),
          txt("statLabel", [116, 340, 332, 90], "caption", "textSecondary", { fit: { maxLines: 3 }, z: 5 }),
          txt("bullets", [552, 134, 332, 300], "body", "textOnPrimary", { fit: { maxItems: 5, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("surfaceAlt"),
          shape([120, 130, 760, 300], "surface", { round: 28, shadow: true, z: 1 }),
          circle(140, 156, 44, "accent", { z: 2 }),
          txt("quoteText", [160, 216, 680, 160], "heading", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 18 }, z: 5 }),
          txt("quoteAttribution", [160, 382, 560, 36], "caption", "textSecondary", { fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("surfaceAlt"),
          txt("title", [80, 62, 840, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([80, 168, 552, 322], "surface", { round: 28, shadow: true, z: 1 }),
          chart([120, 204, 472, 250], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([664, 168, 256, 322], "surface", { round: 28, shadow: true, z: 1 }),
          txt("bullets", [696, 204, 192, 250], "caption", "textPrimary", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

tozaQogoz.blueprint.layouts = {
  ...scaffold({
    margin: 96, card: null, cardRadius: 0, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "textSecondary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background"), rule(96, 156, 808, "border", 1, 2)]),
  }),
  ...tozaQogoz.blueprint.layouts,
};

shveysTartib.blueprint.layouts = {
  ...scaffold({
    margin: 88, card: null, cardRadius: 0, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast"
      ? [bleed("contrast"), shape([64, 0, 3, 562.5], "primary", { round: 0, z: 1 })]
      : [bleed("background"), shape([64, 0, 3, 562.5], "border", { round: 0, z: 0 }), shape([936, 0, 3, 562.5], "border", { round: 0, z: 0 })]),
  }),
  ...shveysTartib.blueprint.layouts,
};

qalinKontrast.blueprint.layouts = {
  ...scaffold({
    margin: 56, card: null, cardRadius: 0, cardShadow: false,
    titleColor: "textOnPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: false, eyebrowColor: "accent",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background"), shape([0, 0, 1000, 150], "primary", { round: 0, z: 0 })]),
  }),
  ...qalinKontrast.blueprint.layouts,
};

yumshoqKarta.blueprint.layouts = {
  ...scaffold({
    margin: 80, card: "surface", cardRadius: 28, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast"), circle(760, 340, 300, "accent", { opacity: 0.3, z: 1 })] : [bleed("surfaceAlt"), circle(760, 360, 280, "accent", { opacity: 0.3, z: 0 })]),
  }),
  ...yumshoqKarta.blueprint.layouts,
};

export const simpleTemplates = [tozaQogoz, shveysTartib, qalinKontrast, yumshoqKarta];
