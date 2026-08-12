import type { SlideTemplate } from "../design-types.ts";
import { eskiKlassika } from "./eski-klassika.ts";
import { klassik } from "./klassik.ts";
import { tozaOsmon } from "./toza-osmon.ts";
import { bleed, chart, circle, defaultScale, img, rule, scaffold, shape, txt } from "./kit.ts";

/**
 * FUTURISTIK LIMON — derived from the reference deck the user supplied.
 *
 * Rules read off that deck and encoded below:
 *  - decorative circles are ALWAYS cropped by a slide edge, never centred whole
 *  - the accent colour carries exactly one element per slide (a number, a shape
 *    or a button) — never two competing accents
 *  - one or two full `contrast` slides per deck, used as punctuation
 *  - statistics are set enormous with a small muted caption underneath
 *  - imagery is an isolated 3D clay render with a soft shadow, never a photo
 */
export const futuristikLimon: SlideTemplate = {
  code: "futuristik_limon",
  name: "Futuristik limon",
  style: "super_professional",
  tagline: "Kesilgan doiralar, ulkan raqamlar va 3D clay vizuallar",
  sortOrder: 1,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "isolated 3D clay render object floating with a soft contact shadow on a plain light backdrop, matte finish, single hero object, generous negative space",
    illustrationStyle: "soft 3D clay illustration, rounded geometry, matte plastic material",
    mood: "confident, modern, optimistic",
    decorativeElements: ["edge-cropped circles", "thin outlined rings", "solid accent discs", "rounded pill buttons"],
    chartStyle: "two-tone donut and column charts, no gridlines, thick strokes",
    spacingStyle: "generous, large left margin, strong vertical rhythm",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, mega: 104, display: 60, title: 40 },
    radius: { card: 24, image: 24 },
    fallback: {
      slots: [
        circle(880, -70, 220, "accent", { opacity: 0.45, z: 1 }),
        txt("title", [72, 70, 700, 90], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 26 } }),
        shape([72, 190, 856, 300], "surface", { round: 24, shadow: true, z: 1 }),
        txt("bullets", [110, 224, 780, 232], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          circle(690, -110, 340, "accent", { z: 1 }),
          circle(600, 40, 250, "accent", { opacity: 0.45, z: 2 }),
          circle(560, 300, 150, "secondary", { opacity: 0.5, z: 1 }),
          txt("brand", [72, 66, 300, 24], "micro", "textSecondary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 } }),
          txt("title", [72, 150, 620, 200], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 34 }, z: 5 }),
          txt("subtitle", [74, 372, 540, 64], "body", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
          circle(72, 452, 56, "contrast", { z: 4 }),
          txt("pageNumber", [828, 496, 100, 20], "micro", "textSecondary", { align: "right", fit: { maxLines: 1 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          circle(-90, 330, 300, "secondary", { opacity: 0.55, z: 1 }),
          txt("title", [72, 62, 620, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          txt("statValue", [72, 168, 500, 140], "mega", "textPrimary", { weight: 700, fit: { maxLines: 1, minFont: 48 }, z: 5 }),
          rule(74, 322, 120, "accent", 6, 4),
          txt("statLabel", [72, 350, 430, 110], "body", "textSecondary", { fit: { maxLines: 4 }, z: 5 }),
          shape([586, 150, 342, 300], "contrast", { round: 24, z: 2 }),
          txt("bullets", [620, 186, 274, 228], "caption", "textOnContrast", { fit: { maxItems: 4, maxChars: 110, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          bleed("contrast"),
          circle(760, -80, 300, "accent", { opacity: 0.9, z: 1 }),
          txt("quoteText", [82, 150, 640, 220], "title", "textOnContrast", { weight: 700, fit: { maxLines: 5, minFont: 24 }, z: 5 }),
          rule(84, 392, 96, "accent", 6, 4),
          txt("quoteAttribution", [82, 418, 480, 46], "caption", "textOnContrast", { fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "contrast",
      },
      chart: {
        slots: [
          txt("title", [72, 62, 856, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([72, 166, 480, 320], "surface", { round: 24, shadow: true, z: 1 }),
          chart([112, 200, 400, 252], "donut", "accent", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          txt("bullets", [590, 190, 340, 280], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 120, minFont: 15 }, grow: true, z: 5 }),
          circle(900, 430, 140, "accent", { opacity: 0.35, z: 0 }),
        ],
      },
      two_columns: {
        slots: [
          txt("title", [72, 62, 856, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([72, 168, 404, 318], "surface", { round: 24, shadow: true, z: 1 }),
          shape([524, 168, 404, 318], "contrast", { round: 24, z: 1 }),
          txt("bullets", [108, 204, 332, 250], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 120, minFont: 15 }, z: 5 }),
          txt("body", [560, 204, 332, 250], "body", "textOnContrast", { fit: { maxItems: 4, maxChars: 120, minFont: 15 }, z: 5 }),
          circle(468, 296, 64, "accent", { z: 4 }),
        ],
      },
      comparison: {
        slots: [
          txt("title", [72, 62, 856, 74], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([72, 168, 404, 318], "surface", { round: 24, shadow: true, z: 1 }),
          shape([524, 168, 404, 318], "accent", { round: 24, z: 1 }),
          txt("bullets", [108, 204, 332, 250], "body", "textPrimary", { fit: { maxItems: 4, maxChars: 120, minFont: 15 }, z: 5 }),
          txt("body", [560, 204, 332, 250], "body", "textOnAccent", { fit: { maxItems: 4, maxChars: 120, minFont: 15 }, z: 5 }),
        ],
      },
      title_body: {
        slots: [
          circle(878, -64, 210, "accent", { opacity: 0.4, z: 1 }),
          txt("title", [72, 66, 470, 120], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 24 } }),
          rule(74, 206, 96, "accent", 6, 4),
          txt("bullets", [72, 240, 430, 250], "body", "textSecondary", { fit: { maxItems: 5, maxChars: 140, minFont: 15 }, grow: true, z: 5 }),
          img([556, 60, 372, 442], { radius: 24, z: 3 }),
          shape([556, 60, 372, 442], "surfaceAlt", { round: 24, when: "noImage", z: 2 }),
          circle(676, 210, 132, "accent", { when: "noImage", opacity: 0.55, z: 3 }),
        ],
      },
    },
  },
};

/** KECHA STUDIYASI — a dark deck; contrast is the ground, accent is the light. */
export const kechaStudiyasi: SlideTemplate = {
  code: "kecha_studiyasi",
  name: "Kecha studiyasi",
  style: "super_professional",
  tagline: "Qorong'i fon, yorug'lik urg'usi va kinematik tinchlik",
  sortOrder: 2,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "dramatic low-key studio product photograph on a dark seamless backdrop, single rim light, deep shadows, cinematic",
    illustrationStyle: "luminous minimal 3D object lit from one side against darkness",
    mood: "premium, calm, cinematic",
    decorativeElements: ["thin luminous rules", "soft radial glow", "outlined rings"],
    chartStyle: "glowing thin-stroke charts on dark ground",
    spacingStyle: "wide margins, quiet composition",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, mega: 96, display: 54 },
    radius: { card: 20, image: 20 },
    fallback: {
      background: "contrast",
      slots: [
        bleed("contrast"),
        txt("title", [84, 70, 832, 88], "title", "textOnContrast", { weight: 700, fit: { maxLines: 2, minFont: 26 } }),
        rule(86, 176, 88, "accent", 3, 3),
        txt("bullets", [84, 214, 832, 274], "body", "textOnContrast", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        background: "contrast",
        slots: [
          bleed("contrast"),
          circle(700, 80, 400, "primary", { opacity: 0.28, z: 1 }),
          circle(760, 140, 280, "accent", { opacity: 0.22, z: 1 }),
          txt("brand", [84, 70, 300, 24], "micro", "accent", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 } }),
          txt("title", [84, 168, 600, 190], "display", "textOnContrast", { weight: 700, fit: { maxLines: 3, minFont: 32 }, z: 5 }),
          rule(86, 382, 88, "accent", 3, 4),
          txt("subtitle", [84, 408, 520, 60], "body", "textOnContrast", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      statistic: {
        background: "contrast",
        slots: [
          bleed("contrast"),
          circle(-120, 260, 340, "primary", { opacity: 0.22, z: 1 }),
          txt("title", [84, 64, 620, 70], "heading", "textOnContrast", { weight: 600, fit: { maxLines: 2 } }),
          txt("statValue", [84, 156, 520, 140], "mega", "accent", { weight: 700, fit: { maxLines: 1, minFont: 46 }, z: 5 }),
          txt("statLabel", [84, 318, 440, 110], "body", "textOnContrast", { fit: { maxLines: 4 }, z: 5 }),
          shape([610, 150, 306, 300], "primary", { round: 20, opacity: 0.35, outline: "accent", outlineWidth: 1, z: 2 }),
          txt("bullets", [644, 186, 240, 228], "caption", "textOnContrast", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
      quote: {
        background: "contrast",
        slots: [
          bleed("contrast"),
          circle(430, 60, 440, "accent", { opacity: 0.14, z: 1 }),
          txt("quoteText", [110, 160, 780, 220], "title", "textOnContrast", { weight: 700, align: "center", fit: { maxLines: 5, minFont: 24 }, z: 5 }),
          txt("quoteAttribution", [110, 404, 780, 44], "caption", "accent", { align: "center", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      chart: {
        background: "contrast",
        slots: [
          bleed("contrast"),
          txt("title", [84, 64, 832, 70], "title", "textOnContrast", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          chart([84, 168, 500, 300], "line", "accent", { trackColor: "primary", labelColor: "textOnContrast", z: 4 }),
          shape([618, 168, 298, 300], "primary", { round: 20, opacity: 0.3, z: 1 }),
          txt("bullets", [650, 202, 234, 232], "caption", "textOnContrast", { fit: { maxItems: 4, maxChars: 110, minFont: 13 }, z: 5 }),
        ],
      },
      title_body: {
        background: "contrast",
        slots: [
          bleed("contrast"),
          txt("title", [84, 68, 430, 120], "title", "textOnContrast", { weight: 700, fit: { maxLines: 3, minFont: 24 } }),
          rule(86, 206, 88, "accent", 3, 4),
          txt("bullets", [84, 240, 400, 250], "body", "textOnContrast", { fit: { maxItems: 5, maxChars: 130, minFont: 15 }, grow: true, z: 5 }),
          img([548, 58, 380, 446], { radius: 20, z: 3 }),
          shape([548, 58, 380, 446], "primary", { round: 20, opacity: 0.3, when: "noImage", z: 2 }),
        ],
      },
    },
  },
};

/** EDITORIAL OYNA — translucent glass cards laid over generous imagery. */
export const editorialOyna: SlideTemplate = {
  code: "editorial_oyna",
  name: "Editorial oyna",
  style: "super_professional",
  tagline: "Shaffof oyna kartalar va jurnal tipografikasi",
  sortOrder: 3,
  previewLayout: "title_body",
  artDirection: {
    imageStyle: "editorial wide-angle photograph with strong depth of field and a calm colour story, magazine quality, room for an overlay card",
    illustrationStyle: "photographic editorial imagery with soft gradients",
    mood: "refined, editorial, considered",
    decorativeElements: ["translucent glass cards", "hairline rules", "small caps labels"],
    chartStyle: "restrained charts inside glass cards",
    spacingStyle: "asymmetric editorial grid",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, display: 52, title: 36, body: 20 },
    radius: { card: 18, image: 18 },
    fallback: {
      slots: [
        shape([64, 54, 872, 454], "surfaceAlt", { round: 18, z: 0 }),
        shape([104, 96, 792, 370], "surface", { round: 18, opacity: 0.92, shadow: true, z: 1 }),
        txt("title", [148, 132, 704, 84], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
        txt("bullets", [148, 236, 704, 196], "body", "textSecondary", { fit: { maxItems: 5, maxChars: 140, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          img([0, 0, 1000, 562.5], { radius: 0, z: 0 }),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, opacity: 0.38, when: "hasImage", z: 1 }),
          shape([0, 0, 1000, 562.5], "surfaceAlt", { round: 0, when: "noImage", z: 0 }),
          shape([72, 132, 560, 300], "surface", { round: 18, opacity: 0.94, shadow: true, z: 2 }),
          txt("brand", [110, 168, 480, 22], "micro", "primary", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 } }),
          txt("title", [110, 204, 484, 148], "display", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 30 }, z: 5 }),
          txt("subtitle", [110, 362, 484, 52], "caption", "textSecondary", { when: "hasSubtitle", fit: { maxLines: 2 }, z: 5 }),
        ],
      },
      statistic: {
        slots: [
          shape([0, 0, 1000, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          shape([64, 62, 420, 438], "surface", { round: 18, shadow: true, z: 1 }),
          txt("title", [102, 100, 344, 62], "heading", "textSecondary", { weight: 600, fit: { maxLines: 2 } }),
          txt("statValue", [102, 182, 344, 130], "mega", "primary", { weight: 700, fit: { maxLines: 1, minFont: 44 }, z: 5 }),
          txt("statLabel", [102, 330, 344, 130], "caption", "textSecondary", { fit: { maxLines: 5 }, z: 5 }),
          shape([524, 62, 412, 438], "contrast", { round: 18, z: 1 }),
          txt("bullets", [562, 104, 336, 354], "body", "textOnContrast", { fit: { maxItems: 5, maxChars: 120, minFont: 14 }, z: 5 }),
        ],
      },
      quote: {
        slots: [
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, z: 0 }),
          rule(84, 150, 72, "accent", 3, 3),
          txt("quoteText", [84, 184, 720, 210], "title", "textOnContrast", { weight: 700, fit: { maxLines: 5, minFont: 24 }, z: 5 }),
          txt("quoteAttribution", [84, 418, 560, 44], "caption", "accent", { fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "contrast",
      },
      title_body: {
        slots: [
          shape([0, 0, 1000, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          img([500, 0, 500, 562.5], { radius: 0, z: 1 }),
          shape([500, 0, 500, 562.5], "secondary", { round: 0, when: "noImage", z: 1 }),
          shape([64, 76, 468, 412], "surface", { round: 18, opacity: 0.96, shadow: true, z: 2 }),
          txt("sectionLabel", [104, 112, 392, 22], "micro", "primary", { weight: 600, letterSpacing: 2, transform: "upper", literal: "Mavzu", fit: { maxLines: 1 }, z: 5 }),
          txt("title", [104, 146, 392, 96], "title", "textPrimary", { weight: 700, fit: { maxLines: 3, minFont: 22 }, z: 5 }),
          txt("bullets", [104, 258, 392, 194], "caption", "textSecondary", { fit: { maxItems: 5, maxChars: 130, minFont: 13 }, grow: true, z: 5 }),
        ],
      },
      chart: {
        slots: [
          shape([0, 0, 1000, 562.5], "surfaceAlt", { round: 0, z: 0 }),
          txt("title", [64, 62, 872, 70], "title", "textPrimary", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          shape([64, 162, 560, 330], "surface", { round: 18, shadow: true, z: 1 }),
          chart([104, 196, 480, 262], "bar", "primary", { trackColor: "surfaceAlt", labelColor: "textSecondary", z: 4 }),
          shape([656, 162, 280, 330], "surface", { round: 18, shadow: true, z: 1 }),
          txt("bullets", [690, 196, 212, 262], "caption", "textSecondary", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
      },
    },
  },
};

/** KINEMATIK QATLAM — full-bleed imagery with layered type blocks. */
export const kinematikQatlam: SlideTemplate = {
  code: "kinematik_qatlam",
  name: "Kinematik qatlam",
  style: "super_professional",
  tagline: "To'la ekran vizual va qatlamli matn bloklari",
  sortOrder: 4,
  previewLayout: "cover",
  artDirection: {
    imageStyle: "cinematic wide establishing shot, anamorphic feel, rich contrast, strong single subject positioned off-centre with clean negative space",
    illustrationStyle: "cinematic photography with graded colour",
    mood: "bold, cinematic, immersive",
    decorativeElements: ["full-bleed imagery", "solid type blocks", "thick accent bars"],
    chartStyle: "oversized charts on solid blocks",
    spacingStyle: "edge-to-edge, block based",
    typography: { display: "Manrope", body: "Manrope" },
  },
  blueprint: {
    type: { ...defaultScale, mega: 110, display: 62, title: 40 },
    radius: { card: 0, image: 0 },
    fallback: {
      slots: [
        bleed("background"),
        shape([0, 0, 340, 562.5], "contrast", { round: 0, z: 1 }),
        txt("title", [48, 74, 244, 160], "heading", "textOnContrast", { weight: 700, fit: { maxLines: 4, minFont: 20 }, z: 5 }),
        rule(48, 262, 72, "accent", 6, 4),
        txt("bullets", [388, 92, 564, 380], "body", "textPrimary", { fit: { maxItems: 5, maxChars: 150, minFont: 15 }, z: 5 }),
      ],
    },
    layouts: {
      cover: {
        slots: [
          img([0, 0, 1000, 562.5], { radius: 0, z: 0 }),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, opacity: 0.45, when: "hasImage", z: 1 }),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, when: "noImage", z: 0 }),
          shape([0, 300, 620, 262], "contrast", { round: 0, opacity: 0.85, z: 2 }),
          rule(72, 336, 96, "accent", 8, 4),
          txt("title", [72, 364, 500, 130], "display", "textOnContrast", { weight: 700, fit: { maxLines: 2, minFont: 34 }, z: 5 }),
          txt("brand", [72, 66, 300, 24], "micro", "textOnContrast", { weight: 600, letterSpacing: 3, transform: "upper", fit: { maxLines: 1 }, z: 5 }),
        ],
        background: "contrast",
      },
      statistic: {
        slots: [
          bleed("contrast"),
          img([500, 0, 500, 562.5], { radius: 0, z: 1 }),
          shape([0, 0, 520, 562.5], "accent", { round: 0, z: 2 }),
          txt("statValue", [64, 150, 400, 150], "mega", "textOnAccent", { weight: 700, fit: { maxLines: 1, minFont: 48 }, z: 5 }),
          rule(66, 318, 88, "contrast", 6, 4),
          txt("statLabel", [64, 348, 392, 130], "body", "textOnAccent", { fit: { maxLines: 4 }, z: 5 }),
          txt("title", [64, 66, 392, 62], "caption", "textOnAccent", { weight: 600, transform: "upper", letterSpacing: 2, fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "contrast",
      },
      quote: {
        slots: [
          img([0, 0, 1000, 562.5], { radius: 0, z: 0 }),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, opacity: 0.62, z: 1 }),
          txt("quoteText", [110, 150, 780, 230], "display", "textOnContrast", { weight: 700, align: "center", fit: { maxLines: 4, minFont: 28 }, z: 5 }),
          txt("quoteAttribution", [110, 410, 780, 44], "caption", "accent", { align: "center", fit: { maxLines: 2 }, z: 5 }),
        ],
        background: "contrast",
      },
      title_body: {
        slots: [
          bleed("background"),
          img([420, 0, 580, 562.5], { radius: 0, z: 1 }),
          shape([420, 0, 580, 562.5], "surfaceAlt", { round: 0, when: "noImage", z: 1 }),
          shape([0, 0, 460, 562.5], "contrast", { round: 0, z: 2 }),
          txt("title", [56, 92, 348, 140], "title", "textOnContrast", { weight: 700, fit: { maxLines: 3, minFont: 24 }, z: 5 }),
          rule(58, 254, 72, "accent", 6, 4),
          txt("bullets", [56, 288, 348, 200], "caption", "textOnContrast", { fit: { maxItems: 5, maxChars: 110, minFont: 13 }, grow: true, z: 5 }),
        ],
      },
      chart: {
        slots: [
          bleed("contrast"),
          shape([0, 0, 1000, 562.5], "contrast", { round: 0, z: 0 }),
          txt("title", [64, 62, 872, 70], "title", "textOnContrast", { weight: 700, fit: { maxLines: 2, minFont: 24 } }),
          chart([64, 168, 560, 320], "bar", "accent", { trackColor: "primary", labelColor: "textOnContrast", z: 4 }),
          shape([672, 168, 264, 320], "accent", { round: 0, z: 1 }),
          txt("bullets", [704, 202, 200, 252], "caption", "textOnAccent", { fit: { maxItems: 4, maxChars: 100, minFont: 13 }, z: 5 }),
        ],
        background: "contrast",
      },
    },
  },
};

// Utilitarian layouts come from each template's own vocabulary.
futuristikLimon.blueprint.layouts = {
  ...scaffold({
    margin: 72, card: "surface", cardRadius: 24, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textPrimary", titleFont: "title",
    eyebrow: true, eyebrowColor: "textSecondary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast"), circle(800, -90, 260, "accent", { opacity: 0.9, z: 1 })] : [circle(890, -70, 200, "accent", { opacity: 0.35, z: 1 })]),
  }),
  ...futuristikLimon.blueprint.layouts,
};

kechaStudiyasi.blueprint.layouts = {
  ...scaffold({
    margin: 84, card: "primary", cardRadius: 20, cardShadow: false,
    titleColor: "textOnContrast", bodyColor: "textOnContrast", titleFont: "title",
    eyebrow: true, eyebrowColor: "accent",
    chrome: () => [bleed("contrast"), circle(760, 120, 320, "primary", { opacity: 0.22, z: 1 })],
  }),
  ...kechaStudiyasi.blueprint.layouts,
};

editorialOyna.blueprint.layouts = {
  ...scaffold({
    margin: 64, card: "surface", cardRadius: 18, cardShadow: true,
    titleColor: "textPrimary", bodyColor: "textSecondary", titleFont: "title",
    eyebrow: true, eyebrowColor: "primary",
    chrome: (variant) => (variant === "contrast" ? [bleed("contrast")] : [shape([0, 0, 1000, 562.5], "surfaceAlt", { round: 0, z: 0 })]),
  }),
  ...editorialOyna.blueprint.layouts,
};

kinematikQatlam.blueprint.layouts = {
  ...scaffold({
    margin: 64, card: null, cardRadius: 0, cardShadow: false,
    titleColor: "textOnContrast", bodyColor: "textOnContrast", titleFont: "title",
    eyebrow: true, eyebrowColor: "accent",
    chrome: () => [bleed("contrast"), rule(64, 500, 120, "accent", 6, 3)],
  }),
  ...kinematikQatlam.blueprint.layouts,
};

/**
 * Klassik and Toza osmon are the two Premium designs. The four that used to sit
 * here — Futuristik limon, Kecha studiyasi, Editorial oyna, Kinematik qatlam —
 * were withdrawn on request. Their blueprints stay in this file rather than
 * being deleted outright: a deck generated while they were live still names its
 * template, and `resolveTemplate()` needs somewhere to look before it falls back.
 * They are simply no longer offered.
 */
export const superProfessionalTemplates = [klassik, tozaOsmon, eskiKlassika];

/** Withdrawn from the picker, kept resolvable for decks already generated. */
export const retiredSuperProfessionalTemplates = [futuristikLimon, kechaStudiyasi, editorialOyna, kinematikQatlam];
