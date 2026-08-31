/**
 * One scene, compiled into the rows every renderer already draws.
 *
 * The brief asks for a single source of truth across the phone, the web
 * preview and the exported PowerPoint. The cheapest way to get one is not a
 * new renderer in three places — it is to compile the scene into the element
 * shape all three already understand. The phone gains a design engine without
 * a line of new drawing code, and a deck made this way opens in the editor
 * beside every deck made before it.
 *
 * Two conversions happen here and nowhere else. Geometry drops from the
 * 1920×1080 canvas the engine reasons about to the 1000×562.5 model the apps
 * store, and roles become values: `ink` becomes a hex from the deck's palette,
 * `display` becomes the family the library gave that role, `title` becomes a
 * size in the model's units. After this point nothing is a role any more.
 */

import { CANVAS, TYPE_SCALE, type ColorRole, type Scene, type SceneElement } from "./scene-spec.ts";
import { CARD_PADDING, placeScene, type PlacedElement } from "./scene-geometry.ts";
import type { DesignDNA } from "./scene-dna.ts";

/** The apps store geometry in a 1000-wide model; the engine reasons at 1920. */
export const MODEL_SCALE = 1000 / CANVAS.width;

const scale = (value: number) => Math.round(value * MODEL_SCALE * 100) / 100;

export type RenderedRow = {
  type: "text" | "image" | "shape" | "line" | "chart";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};

export type RenderedSlide = {
  background: Record<string, unknown>;
  elements: RenderedRow[];
};

/** A picture the image service found, keyed by the intent that asked for it. */
export type ResolvedPicture = { bucket: string; path: string } | { url: string };

/**
 * Layers, so decoration cannot land on top of words.
 *
 * The collision check already refuses a rule crossing a paragraph, but a
 * decorative panel behind a card is legitimate and common — so the order has to
 * be right as well as the geometry. Type is always last.
 */
const LAYER = {
  bleed: 0,
  decoration: 1,
  card: 2,
  media: 3,
  child: 4,
  text: 5,
} as const;

const LINE_HEIGHT: Record<keyof typeof TYPE_SCALE, number> = {
  display: 1.02, title: 1.06, heading: 1.12, lead: 1.35,
  body: 1.5, caption: 1.45, micro: 1.4, statistic: 0.96,
};

/**
 * Never below one.
 *
 * React Native clips a line shorter than its own type where CSS merely
 * overlaps, so a design asking for 0.92 loses the tops of its letters on the
 * phone and nowhere else.
 */
const lineHeightFor = (step: keyof typeof TYPE_SCALE): number => Math.max(1.02, LINE_HEIGHT[step]);

/** Charts are drawn from a three-value vocabulary every renderer already has. */
const CHART_FALLBACK: Record<string, string> = {
  bar: "bar", line: "bar", area: "bar", pie: "pie", doughnut: "donut",
};

/**
 * A gradient in the shape every renderer already reads.
 *
 * `gradientStops` and `gradientAngle`, because that is what the phone, the web
 * preview and the exporter look for. Anything else is drawn as a flat fill and
 * nothing says so.
 */
function gradientStyle(input: { from: string; to: string; angle: number }): Record<string, unknown> {
  return {
    gradientStops: [{ color: input.from, offset: 0 }, { color: input.to, offset: 100 }],
    gradientAngle: input.angle,
  };
}

export function renderScene(
  scene: Scene,
  dna: DesignDNA,
  pictures: ReadonlyMap<string, ResolvedPicture> = new Map(),
): RenderedSlide {
  const color = (role: ColorRole): string => dna.colors[role];
  const rows: RenderedRow[] = [];

  const pictureFor = (query: string): Record<string, unknown> => {
    const found = pictures.get(query);
    if (!found) return { kind: "image" };
    return "url" in found
      ? { kind: "image", url: found.url }
      : { kind: "image", storageBucket: found.bucket, storagePath: found.path };
  };

  const push = (entry: PlacedElement, layer: number, style: Record<string, unknown>, content: Record<string, unknown>, type: RenderedRow["type"]) => {
    rows.push({
      type,
      x: scale(entry.box.x),
      y: scale(entry.box.y),
      width: scale(entry.box.width),
      height: scale(entry.box.height),
      rotation: 0,
      z_index: layer,
      opacity: 1,
      locked: false,
      style,
      content,
    });
  };

  /**
   * A picture asked for as a background becomes the page's first element.
   *
   * Added before everything else so it sits underneath, and given the same
   * overlay the background asked for — the scrim is what makes type over a
   * photograph readable, and the palette cannot know what the photograph looks
   * like.
   */
  const asBackground: SceneElement[] = scene.background.kind === "image"
    ? [{
      type: "image",
      place: { column: 0, span: 12, row: 0, rows: 8, bleed: true },
      treatment: "full_bleed",
      intent: scene.background.intent,
      overlay: scene.background.overlay ?? "scrim_bottom",
      ...(scene.background.focus ? { focus: scene.background.focus } : {}),
    }]
    : [];

  for (const entry of placeScene({ ...scene, elements: [...asBackground, ...scene.elements] })) {
    const element = entry.element as SceneElement;
    const inCard = entry.path.includes(".children");

    switch (element.type) {
      case "text": {
        const size = TYPE_SCALE[element.typography.step];
        push(entry, inCard ? LAYER.child : LAYER.text, {
          color: color(element.typography.color),
          fontSize: scale(size),
          lineHeight: scale(size * (element.typography.lineHeight ?? lineHeightFor(element.typography.step))),
          textAlign: element.typography.align === "center" ? "center" : element.typography.align === "end" ? "right" : "left",
          fontFamily: dna.fonts[element.typography.font],
          letterSpacing: element.typography.tracking ?? 0,
          fontWeight: element.typography.step === "display" || element.typography.step === "title" || element.typography.step === "statistic" ? "700" : "400",
        }, { text: element.text, role: element.role }, "text");
        break;
      }
      case "image": {
        const bleed = Boolean(element.place.bleed);
        push(entry, bleed ? LAYER.bleed : LAYER.media, {
          objectFit: "cover",
          borderRadius: element.treatment === "circle"
            ? scale(Math.min(entry.box.width, entry.box.height) / 2)
            : element.treatment === "full_bleed" ? 0 : scale(element.radius ?? dna.radius),
          ...(element.focus ? { focusX: element.focus.x, focusY: element.focus.y } : {}),
        }, pictureFor(element.intent.query), "image");

        /**
         * The scrim is a shape, because that is what every renderer can draw.
         *
         * Text over a photograph is only readable when something sits between
         * them, and the palette cannot know what the photograph looks like —
         * so the contrast is bought here rather than assumed.
         */
        if (element.overlay && element.overlay !== "none") {
          rows.push({
            type: "shape",
            x: scale(entry.box.x),
            y: scale(entry.box.y),
            width: scale(entry.box.width),
            height: scale(entry.box.height),
            rotation: 0,
            z_index: (bleed ? LAYER.bleed : LAYER.media) + 0.5,
            opacity: element.overlay === "veil" ? 0.55 : 0.72,
            locked: false,
            /**
             * In the renderers' own gradient vocabulary, not ours.
             *
             * They read `gradientStops` with a `gradientAngle`; a `gradient`
             * object is simply not seen — which turned a scrim meant to fade
             * from nothing into a flat black sheet at 72% over the whole
             * photograph. The scene may describe a gradient however it likes;
             * what is stored has to be what the phone already draws.
             */
            style: {
              fill: "#000000",
              ...gradientStyle(element.overlay === "scrim_left"
                ? { from: "#000000", to: "#00000000", angle: 90 }
                : { from: "#00000000", to: "#000000", angle: 180 }),
              borderRadius: element.treatment === "full_bleed" ? 0 : scale(element.radius ?? dna.radius),
            },
            content: { kind: "scrim" },
          });
        }
        break;
      }
      case "card": {
        const treatment = element.treatment;
        push(entry, LAYER.card, {
          fill: treatment === "dark" ? color("ink") : treatment === "outline" ? "transparent" : color("surface"),
          borderRadius: scale(element.radius ?? dna.radius),
          borderWidth: treatment === "outline" ? 1 : 0,
          borderColor: color("inkMuted"),
          opacity: treatment === "glass" ? 0.86 : 1,
          ...(treatment === "gradient" ? gradientStyle({ from: color("primary"), to: color("accent"), angle: 160 }) : {}),
          padding: scale(CARD_PADDING),
        }, { kind: "card" }, "shape");
        break;
      }
      case "chart": {
        push(entry, LAYER.media, {
          palette: [color("chart1"), color("chart2"), color("chart3"), color("chart4")],
          // A default PowerPoint chart is what this exists not to look like.
          showLegend: element.chart.kind === "pie" || element.chart.kind === "doughnut",
          showGrid: false,
          showAxis: element.chart.kind === "bar" || element.chart.kind === "line" || element.chart.kind === "area",
          showValues: true,
          cornerRadius: scale(6),
        }, {
          chartType: CHART_FALLBACK[element.chart.kind] ?? "bar",
          chartKind: element.chart.kind,
          labels: element.chart.labels,
          values: element.chart.values,
          ...(element.chart.unit ? { unit: element.chart.unit } : {}),
        }, "chart");
        break;
      }
      case "shape": {
        if (element.kind === "rule") {
          push(entry, LAYER.decoration, {
            color: color(element.color),
            strokeWidth: 2,
          }, { kind: "rule" }, "line");
        } else if (element.kind === "number") {
          push(entry, LAYER.decoration, {
            color: color(element.color),
            fontSize: scale(TYPE_SCALE.statistic),
            lineHeight: scale(TYPE_SCALE.statistic),
            fontFamily: dna.fonts.display,
            fontWeight: "700",
            textAlign: "left",
          }, { text: element.text ?? "", role: "decoration" }, "text");
        } else {
          push(entry, LAYER.decoration, {
            fill: color(element.color),
            borderRadius: element.kind === "orb" ? scale(Math.min(entry.box.width, entry.box.height) / 2) : scale(dna.radius),
            opacity: element.opacity ?? 0.18,
          }, { kind: element.kind }, "shape");
        }
        break;
      }
    }
  }

  return { background: renderBackground(scene, dna, pictures), elements: rows };
}

function renderBackground(
  scene: Scene,
  dna: DesignDNA,
  pictures: ReadonlyMap<string, ResolvedPicture>,
): Record<string, unknown> {
  const background = scene.background;
  switch (background.kind) {
    case "gradient":
      return {
        color: dna.colors[background.from],
        ...gradientStyle({ from: dna.colors[background.from], to: dna.colors[background.to], angle: background.angle }),
      };
    case "panel_split":
      return { color: dna.colors[background.color], panel: { color: dna.colors[background.panel], at: background.at } };
    case "image":
      /**
       * Handled as an element, not as a background.
       *
       * No renderer draws a photograph behind a slide — they draw elements. A
       * background that named a picture therefore produced a flat colour and a
       * cover with no cover on it, so `renderScene` turns it into the
       * full-bleed image the renderers do draw, and what is left here is the
       * ground behind it.
       */
      return { color: dna.colors.background };
    default:
      return { color: dna.colors[background.color] };
  }
}

/** Every picture this scene needs, so the image service is asked once. */
export function imageIntents(scene: Scene): Array<{ query: string; orientation: string }> {
  const wanted: Array<{ query: string; orientation: string }> = [];
  const seen = new Set<string>();
  const add = (intent: { query: string; orientation: string }) => {
    if (seen.has(intent.query)) return;
    seen.add(intent.query);
    wanted.push(intent);
  };
  if (scene.background.kind === "image") add(scene.background.intent);
  const walk = (elements: readonly SceneElement[]) => {
    for (const element of elements) {
      if (element.type === "image") add(element.intent);
      if (element.type === "card") walk(element.children);
    }
  };
  walk(scene.elements);
  return wanted;
}
