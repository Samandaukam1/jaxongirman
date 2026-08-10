import type { SlideTemplate } from "../design-types.ts";
import { bleed, chart, circle, defaultScale, icon, img, rule, scaffold, shape, txt } from "./kit.ts";

/** IKON OQIMI — icon-led rows; each point gets a glyph and a lane. */
export const ikonOqimi: SlideTemplate = {
  code: "ikon_oqimi",
  name: "Ikon oqimi",
  style: "good",
  tagline: "Har bir fikr o'z ikoni va yo'lagi bilan",
  sortOrder: 1,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "clean conceptual image with a single clear subject and uncluttered background",
    illustrationStyle: "line-icon driven diagrams",
    mood: "clear, practical, organised",
    decorativeElements: ["icon chips", "lane dividers", "numbered markers"],
    chartStyle: "simple column charts with labelled axes",
    spacingStyle: "regular rows with consistent rhythm",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 48, title: 34 },
    radius: { card: 18, image: 18 },
    fallback: {
      slots: [
        bleed("background"),
        txt("title", [72, 66, 856, 76], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
        shape([72, 178, 856, 312], "surface", { round: 18, z: 1 }),
        ...[0, 1, 2].map((row) => shape([104, 210 + row * 92, 52, 52], "secondary", { round: 16, z: 2 })),
        ...[0, 1, 2].map((row) => icon([118, 224 + row * 92, 24, 24], ["Sparkles", "Layers", "Target"][row]!, "primary", { z: 3 })),
        txt("bullets", [180, 206, 716, 268], "body", "textPrimary", { fit: { maxItems: 3, maxChars: 150, minFont: 16 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          shape([620, 0, 380, 562.5], "secondary", { round: 0, z: 0 }),
          circle(700, 180, 220, "accent", { opacity: 0.55, z: 1 }),
          icon([772, 252, 76, 76], "Sparkles", "primary", { z: 3 }),
          txt("brand", [72, 70, 400, 24], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [72, 172, 500, 180], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 28 }, z: 5 }),
          txt("subtitle", [72, 378, 480, 56], "body", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          txt("title", [72, 66, 856, 72], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          ...[0, 1, 2].map((row) => shape([72, 176 + row * 108, 856, 92], "surface", { round: 18, z: 1 })),
          ...[0, 1, 2].map((row) => shape([100, 196 + row * 108, 52, 52], "secondary", { round: 16, z: 2 })),
          ...[0, 1, 2].map((row) => icon([114, 210 + row * 108, 24, 24], ["Target", "Layers", "Sparkles"][row]!, "primary", { z: 3 })),
          txt("bullets", [176, 190, 724, 280], "body", "textPrimary", { fit: { maxItems: 3, maxChars: 120, minFont: 16 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          txt("title", [72, 62, 856, 66], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          shape([72, 152, 404, 316], "surface", { round: 18, z: 1 }),
          shape([108, 186, 56, 56], "accent", { round: 16, z: 2 }),
          icon([124, 202, 24, 24], "TrendingUp", "textOnAccent", { z: 3 }),
          txt("statValue", [108, 258, 336, 116], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 44 }, z: 5 }),
          txt("statLabel", [108, 384, 336, 62], "caption", "textSecondary", { fit: { maxLines: 3 }, z: 5 }),
          shape([524, 152, 404, 316], "secondary", { round: 18, z: 1 }),
          txt("bullets", [560, 190, 332, 244], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [72, 62, 856, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([72, 162, 556, 330], "surface", { round: 18, z: 1 }),
          chart([112, 196, 476, 262], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([660, 162, 268, 330], "secondary", { round: 18, z: 1 }),
          txt("bullets", [692, 196, 204, 262], "caption", "textPrimary", { fit: { maxItems: 4, maxChars: 90, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("secondary"),
          icon([468, 128, 64, 64], "Quote", "primary", { z: 3 }),
          txt("quoteText", [140, 214, 720, 176], "title", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 4, minFont: 22 }, z: 5 }),
          txt("quoteAttribution", [140, 412, 720, 40], "caption", "textSecondary", { align: "center", fit: { maxLines: 1 }, z: 5 }),
        ],
      },
    },
  },
};

/** MA'LUMOT PANELI — dashboard logic: stat tiles beside a chart. */
export const malumotPaneli: SlideTemplate = {
  code: "malumot_paneli",
  name: "Ma'lumot paneli",
  style: "good",
  tagline: "Dashboard ritmi: ko'rsatkich plitkalari va diagramma",
  sortOrder: 2,
  previewLayout: "chart",
  artDirection: {
    imageStyle: "clean data-oriented image, screens or instruments, neutral background",
    illustrationStyle: "data visual language with tiles and charts",
    mood: "analytical, precise, trustworthy",
    decorativeElements: ["stat tiles", "hairline separators", "compact legends"],
    chartStyle: "dashboard charts with clear labels and a muted grid",
    spacingStyle: "dense but ordered tile grid",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 46, title: 32, mega: 80 },
    radius: { card: 14, image: 14 },
    fallback: {
      slots: [
        bleed("background"),
        txt("title", [64, 58, 872, 64], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
        shape([64, 148, 872, 348], "surface", { round: 14, z: 1 }),
        rule(64, 148, 872, "primary", 4, 2),
        txt("bullets", [100, 186, 800, 280], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("contrast"),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, z: 0 }),
          rule(0, 0, 1000, "primary", 8, 2),
          ...[0, 1, 2].map((tile) => shape([620 + (tile % 2) * 190, 150 + Math.floor(tile / 2) * 150, 170, 130], "primary", { round: 14, opacity: 0.28, z: 1 })),
          txt("brand", [64, 74, 400, 24], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [64, 176, 520, 172], "display", "textOnContrast", { weight: 700, fit: { maxLines: 3, minFont: 28 }, z: 5 }),
          txt("subtitle", [64, 372, 500, 54], "body", "textOnContrast", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "contrast",
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [64, 56, 872, 62], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([64, 142, 596, 356], "surface", { round: 14, z: 1 }),
          rule(64, 142, 596, "primary", 4, 2),
          chart([100, 186, 524, 280], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          ...[0, 1, 2].map((tile) => shape([688, 142 + tile * 122, 248, 110], "surface", { round: 14, z: 1 })),
          txt("bullets", [712, 164, 200, 300], "caption", "textPrimary", { fit: { maxItems: 3, maxChars: 80, minFont: 13 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          txt("title", [64, 56, 872, 62], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([64, 142, 430, 356], "contrast", { round: 14, z: 1 }),
          txt("statValue", [98, 200, 362, 120], "mega", "accent", { weight: 700, fit: { maxLines: 1, minFont: 42 }, z: 5 }),
          rule(100, 336, 72, "accent", 4, 4),
          txt("statLabel", [98, 360, 362, 106], "caption", "textOnContrast", { fit: { maxLines: 4 }, z: 5 }),
          shape([522, 142, 414, 356], "surface", { round: 14, z: 1 }),
          rule(522, 142, 414, "primary", 4, 2),
          txt("bullets", [556, 184, 348, 276], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      two_columns: {
        slots: [
          bleed("background"),
          txt("title", [64, 56, 872, 62], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([64, 142, 430, 356], "surface", { round: 14, z: 1 }),
          shape([522, 142, 414, 356], "surfaceAlt", { round: 14, z: 1 }),
          rule(64, 142, 430, "primary", 4, 2),
          rule(522, 142, 414, "accent", 4, 2),
          txt("bullets", [98, 186, 362, 282], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
          txt("body", [556, 186, 348, 282], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          txt("title", [64, 56, 560, 96], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 22 } }),
          shape([64, 170, 560, 326], "surface", { round: 14, z: 1 }),
          rule(64, 170, 560, "primary", 4, 2),
          txt("bullets", [98, 208, 492, 254], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 120, minFont: 15 }, grow: true, z: 5 }),
          img([652, 56, 284, 440], { radius: 14, z: 3 }),
          shape([652, 56, 284, 440], "surfaceAlt", { round: 14, when: "noImage", z: 2 }),
        ],
      },
    },
  },
};

/** BO'LINGAN EKRAN — an uncompromising 50/50 split on every slide. */
export const bolinganEkran: SlideTemplate = {
  code: "bolingan_ekran",
  name: "Bo'lingan ekran",
  style: "good",
  tagline: "Qat'iy ikkiga bo'lingan kompozitsiya",
  sortOrder: 3,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "portrait-friendly image with the subject on one half and clean space on the other",
    illustrationStyle: "half-frame imagery paired with flat colour",
    mood: "direct, balanced, modern",
    decorativeElements: ["hard vertical split", "full-height colour fields"],
    chartStyle: "charts confined to one half",
    spacingStyle: "two equal fields",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 50, title: 34 },
    radius: { card: 0, image: 0 },
    fallback: {
      slots: [
        bleed("background"),
        shape([500, 0, 500, 562.5], "secondary", { round: 0, z: 0 }),
        txt("title", [64, 82, 372, 110], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
        txt("bullets", [64, 218, 372, 268], "caption", "textSecondary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, z: 5 }),
        txt("body", [564, 218, 372, 268], "caption", "textPrimary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          shape([500, 0, 500, 562.5], "primary", { round: 0, z: 0 }),
          img([500, 0, 500, 562.5], { radius: 0, z: 1 }),
          txt("brand", [64, 74, 380, 24], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [64, 168, 384, 200], "display", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 26 }, z: 5 }),
          txt("subtitle", [64, 392, 372, 56], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          shape([500, 0, 500, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          img([500, 0, 500, 562.5], { radius: 0, z: 1 }),
          txt("title", [64, 76, 372, 116], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          txt("bullets", [64, 220, 372, 266], "caption", "textSecondary", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, grow: true, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          shape([0, 0, 500, 562.5], "contrast", { round: 0, z: 0 }),
          txt("title", [64, 82, 372, 60], "caption", "accent", { weight: 600, transform: "upper", letterSpacing: 2, fit: { maxLines: 2 }, z: 5 }),
          txt("statValue", [64, 170, 372, 140], "mega", "textOnContrast", { weight: 700, fit: { maxLines: 1, minFont: 44 }, z: 5 }),
          txt("statLabel", [64, 336, 372, 130], "caption", "textOnContrast", { fit: { maxLines: 4 }, z: 5 }),
          txt("bullets", [564, 170, 372, 260], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          shape([500, 0, 500, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          txt("title", [64, 76, 372, 108], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          txt("bullets", [64, 212, 372, 274], "caption", "textSecondary", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
          chart([548, 130, 404, 306], "donut", "primary", { trackColor: "surface", labelColor: "textSecondary", z: 4 }),
        ],
      },
      quote: {
        slots: [
          bleed("contrast"),
          shape([0, 0, 500, 562.5], "accent", { round: 0, z: 0 }),
          txt("quoteText", [64, 150, 372, 220], "heading", "textOnAccent", { weight: 700, fit: { maxLines: 6, minFont: 18 }, z: 5 }),
          txt("quoteAttribution", [64, 398, 372, 42], "caption", "textOnAccent", { fit: { maxLines: 2 }, z: 5 }),
          txt("bullets", [564, 150, 372, 268], "caption", "textOnContrast", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
        background: "contrast",
      },
    },
  },
};

/** AYLANA RITM — circles are the organising motif throughout. */
export const aylanaRitm: SlideTemplate = {
  code: "aylana_ritm",
  name: "Aylana ritm",
  style: "good",
  tagline: "Doiralar ritmi va yumaloq kompozitsiya",
  sortOrder: 4,
  previewLayout: "statistic",
  artDirection: {
    imageStyle: "round-friendly subject shot, centred composition suitable for a circular crop",
    illustrationStyle: "circular motifs and concentric rings",
    mood: "soft, harmonious, approachable",
    decorativeElements: ["concentric rings", "circular photo crops", "dot rhythms"],
    chartStyle: "donut charts and radial gauges",
    spacingStyle: "circular rhythm with even spacing",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 50, title: 34 },
    radius: { card: 999, image: 999 },
    fallback: {
      slots: [
        bleed("background"),
        circle(-120, 320, 340, "secondary", { opacity: 0.5, z: 0 }),
        txt("title", [72, 68, 856, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
        shape([72, 186, 856, 300], "surface", { round: 40, z: 1 }),
        txt("bullets", [124, 222, 752, 230], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          bleed("background"),
          circle(560, 20, 420, "secondary", { z: 0 }),
          circle(620, 80, 300, "accent", { opacity: 0.6, z: 1 }),
          circle(690, 150, 160, "primary", { opacity: 0.9, z: 2 }),
          txt("brand", [72, 72, 400, 24], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [72, 176, 440, 190], "display", "textPrimary", { weight: 700, fit: { maxLines: 4, minFont: 26 }, z: 5 }),
          txt("subtitle", [72, 388, 420, 56], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          bleed("background"),
          circle(560, 88, 380, "secondary", { opacity: 0.55, z: 0 }),
          circle(620, 148, 260, "surface", { shadow: true, z: 1 }),
          txt("statValue", [620, 230, 260, 100], "display", "primary", { weight: 700, align: "center", fit: { maxLines: 1, minFont: 34 }, z: 5 }),
          txt("title", [72, 92, 430, 96], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          txt("statLabel", [72, 210, 420, 90], "body", "textSecondary", { fit: { maxLines: 3 }, z: 5 }),
          txt("bullets", [72, 320, 420, 170], "caption", "textPrimary", { fit: { maxItems: 3, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("background"),
          txt("title", [72, 64, 856, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          circle(96, 162, 320, "surface", { shadow: true, z: 1 }),
          chart([136, 202, 240, 240], "donut", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([472, 168, 456, 306], "surfaceAlt", { round: 40, z: 1 }),
          txt("bullets", [516, 206, 368, 234], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 110, minFont: 14 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          bleed("background"),
          circle(620, 90, 340, "secondary", { opacity: 0.5, z: 0 }),
          txt("title", [72, 76, 460, 114], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 } }),
          txt("bullets", [72, 218, 460, 268], "body", "textSecondary", { fit: { maxItems: 5, maxChars: 120, minFont: 15 }, grow: true, z: 5 }),
          img([624, 132, 280, 280], { mask: "circle", z: 3 }),
          circle(660, 168, 208, "accent", { opacity: 0.65, when: "noImage", z: 2 }),
        ],
      },
      quote: {
        slots: [
          bleed("secondary"),
          circle(340, 60, 320, "surface", { opacity: 0.55, z: 0 }),
          txt("quoteText", [150, 172, 700, 190], "title", "textPrimary", { weight: 700, align: "center", fit: { maxLines: 4, minFont: 22 }, z: 5 }),
          circle(484, 388, 32, "accent", { z: 3 }),
          txt("quoteAttribution", [150, 438, 700, 40], "caption", "textSecondary", { align: "center", fit: { maxLines: 1 }, z: 5 }),
        ],
      },
    },
  },
};

ikonOqimi.blueprint.layouts = {
  ...scaffold({
    margin: 72, card: "surface", cardRadius: 18, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background")]),
  }),
  ...ikonOqimi.blueprint.layouts,
};

malumotPaneli.blueprint.layouts = {
  ...scaffold({
    margin: 64, card: "surface", cardRadius: 14, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast"), rule(0, 0, 1000, "primary", 8, 2)] : [bleed("background")]),
  }),
  ...malumotPaneli.blueprint.layouts,
};

bolinganEkran.blueprint.layouts = {
  ...scaffold({
    margin: 64, card: null, cardRadius: 0, cardShadow: false,
    titleColor: "textPrimary", bodyColor: "textSecondary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [bleed("background"), shape([500, 0, 500, 562.5], "surfaceAlt", { round: 0, z: 0 })]),
  }),
  ...bolinganEkran.blueprint.layouts,
};

aylanaRitm.blueprint.layouts = {
  ...scaffold({
    margin: 72, card: "surface", cardRadius: 40, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast"), circle(760, 300, 380, "accent", { opacity: 0.25, z: 1 })] : [bleed("background"), circle(-120, 330, 340, "secondary", { opacity: 0.45, z: 0 })]),
  }),
  ...aylanaRitm.blueprint.layouts,
};

export const goodTemplates = [ikonOqimi, malumotPaneli, bolinganEkran, aylanaRitm];
