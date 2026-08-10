import type {
  Blueprint,
  ChartSlot,
  ColorRole,
  FitRule,
  FontStep,
  Frame,
  IconSlot,
  ImageSlot,
  LayoutRecipe,
  ShapeSlot,
  Slot,
  SlotCondition,
  SlotRole,
  TextSlot,
} from "../design-types.ts";
import type { LayoutName } from "../presentation-types.ts";

/** Slot builders. Keeping these terse is what makes 16 templates reviewable. */

export function txt(
  role: SlotRole,
  frame: Frame,
  font: FontStep,
  color: ColorRole,
  extra: Partial<Omit<TextSlot, "kind" | "role" | "frame" | "font" | "color">> = {},
): TextSlot {
  return { kind: "text", role, frame, font, color, ...extra };
}

export function shape(frame: Frame, color: ColorRole, extra: Partial<Omit<ShapeSlot, "kind" | "frame" | "color">> = {}): ShapeSlot {
  return { kind: "shape", frame, color, ...extra };
}

/** Circle by centre-independent top-left placement; `d` is the diameter. */
export function circle(x: number, y: number, d: number, color: ColorRole, extra: Partial<Omit<ShapeSlot, "kind" | "frame" | "color" | "round">> = {}): ShapeSlot {
  return { kind: "shape", frame: [x, y, d, d], color, round: "full", ...extra };
}

export function bleed(color: ColorRole, extra: Partial<Omit<ShapeSlot, "kind" | "frame" | "color" | "round">> = {}): ShapeSlot {
  return { kind: "shape", frame: [0, 0, 1000, 562.5], color, round: 0, z: 0, ...extra };
}

export function img(frame: Frame, extra: Partial<Omit<ImageSlot, "kind" | "role" | "frame">> = {}): ImageSlot {
  return { kind: "image", role: "image", frame, when: "hasImage", ...extra };
}

export function chart(frame: Frame, type: ChartSlot["chart"], color: ColorRole, extra: Partial<Omit<ChartSlot, "kind" | "role" | "frame" | "chart" | "color">> = {}): ChartSlot {
  return { kind: "chart", role: "chart", frame, chart: type, color, when: "hasChart", ...extra };
}

export function icon(frame: Frame, name: string, color: ColorRole, extra: Partial<Omit<IconSlot, "kind" | "frame" | "icon" | "color">> = {}): IconSlot {
  return { kind: "icon", frame, icon: name, color, ...extra };
}

export function rule(x: number, y: number, width: number, color: ColorRole, thickness = 2, z = 2): ShapeSlot {
  return { kind: "shape", frame: [x, y, width, thickness], color, round: 0, z };
}

/** The type scale most templates share; individual templates override steps. */
export const defaultScale: Blueprint["type"] = {
  mega: 92, display: 56, title: 38, heading: 26, body: 21, caption: 15, micro: 12,
};

export type ScaffoldOptions = {
  /** Left/right text margin. */
  margin: number;
  /** Decor emitted on every utilitarian layout. */
  chrome: (variant: "light" | "contrast") => Slot[];
  /** Colour of body copy cards; `null` renders copy straight on the background. */
  card: ColorRole | null;
  cardRadius: number;
  cardShadow: boolean;
  titleColor: ColorRole;
  bodyColor: ColorRole;
  titleFont: FontStep;
  /** Small label above the title, e.g. section eyebrow. */
  eyebrow: boolean;
  eyebrowColor: ColorRole;
};

const bulletFit: FitRule = { maxItems: 5, maxChars: 150, minFont: 15 };

/**
 * Builds the utilitarian layouts (`title_body`, `agenda`, `timeline`,
 * `conclusion`, `references`) from a template's own vocabulary, so every
 * template stays internally consistent without hand-writing near-identical
 * recipes eleven times. Signature layouts are always authored by hand.
 */
export function scaffold(options: ScaffoldOptions): Partial<Record<LayoutName, LayoutRecipe>> {
  const { margin: m, card, cardRadius, cardShadow, titleColor, bodyColor, titleFont, eyebrow, eyebrowColor } = options;
  const width = 1000 - m * 2;

  const head = (label: string): Slot[] => [
    ...options.chrome("light"),
    ...(eyebrow ? [txt("sectionLabel", [m, 58, width, 22], "micro", eyebrowColor, { weight: 600, letterSpacing: 2, transform: "upper", literal: label, fit: { maxLines: 1 } })] : []),
    txt("title", [m, eyebrow ? 86 : 66, width, 82], titleFont, titleColor, { weight: 700, fit: { maxLines: 2, minFont: 26 } }),
  ];

  const copyBlock = (top: number, height: number, when: SlotCondition = "always"): Slot[] => [
    ...(card ? [shape([m, top, width, height], card, { round: cardRadius, shadow: cardShadow, z: 1, when })] : []),
    txt("bullets", [m + (card ? 34 : 0), top + (card ? 30 : 0), width - (card ? 68 : 0), height - (card ? 60 : 0)], "body", bodyColor, { fit: bulletFit, when, grow: true, z: 5 }),
  ];

  return {
    title_body: { slots: [...head("Mavzu"), ...copyBlock(190, 300)] },
    agenda: {
      slots: [
        ...head("Reja"),
        ...(card ? [shape([m, 190, width, 300], card, { round: cardRadius, shadow: cardShadow, z: 1 })] : []),
        txt("bullets", [m + (card ? 34 : 0), 220, width - (card ? 68 : 0), 240], "heading", bodyColor, { fit: { maxItems: 6, maxChars: 90, minFont: 17 }, z: 5 }),
      ],
    },
    timeline: {
      slots: [
        ...head("Bosqichlar"),
        rule(m, 232, width, "border", 2, 2),
        ...[0, 1, 2, 3].map((step) => circle(m + step * (width / 4), 222, 22, step === 0 ? "accent" : "surfaceAlt", { z: 3, outline: "border", outlineWidth: 1 })),
        txt("bullets", [m, 272, width, 210], "body", bodyColor, { fit: bulletFit, z: 5 }),
      ],
    },
    conclusion: {
      slots: [
        ...options.chrome("contrast"),
        txt("title", [m, 150, width - 120, 110], "display", "textOnContrast", { weight: 700, fit: { maxLines: 2, minFont: 32 } }),
        txt("bullets", [m, 292, width - 160, 190], "body", "textOnContrast", { fit: { ...bulletFit, maxItems: 4 }, z: 5 }),
      ],
      background: "contrast",
    },
    references: {
      slots: [
        ...head("Manbalar"),
        txt("sources", [m, 186, width, 306], "caption", bodyColor, { fit: { maxItems: 12, maxChars: 150, minFont: 12 }, z: 5 }),
      ],
    },
  };
}
