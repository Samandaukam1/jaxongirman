import {
  SLIDE_MODEL_HEIGHT,
  SLIDE_MODEL_WIDTH,
  type Json,
  type RenderableSlide,
  type RenderableSlideElement,
} from "@jaxongirman/types";
import * as LucideIcons from "lucide-react";
import { Image as ImageGlyph, Play, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * The DOM slide painter.
 *
 * One component, used by the web viewer and by the admin console's design
 * preview. It paints element rows that are already positioned — it decides
 * nothing about layout, which is the render engine's job (§103). What it does
 * decide is how a row's style bag becomes CSS, and that has to be identical
 * everywhere or an admin's preview stops being a preview (§61, §85).
 *
 * It understands both vocabularies: the two-stop gradients and boolean shadows
 * the built-in blueprints emit, and the full stop lists and shadow objects
 * JSLAYD adds. A row carrying both gets the richer reading.
 */

type Bag = { [key: string]: Json | undefined };

export const SLIDE_WIDTH = SLIDE_MODEL_WIDTH;
export const SLIDE_HEIGHT = SLIDE_MODEL_HEIGHT;

function bag(value: Json | undefined): Bag {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Bag) : {};
}

function num(value: Json | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: Json | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function list(value: Json | undefined): Bag[] {
  return Array.isArray(value) ? value.map((entry) => bag(entry as Json)) : [];
}

/* ------------------------------------------------------------------ paint */

/**
 * A fill, read from either vocabulary.
 *
 * `gradientStops` is JSLAYD's full list; `fill`/`gradientTo` is the two-stop
 * pair every built-in blueprint emits and which JSLAYD also emits alongside the
 * list. Preferring the list when present is what makes a three-stop gradient
 * actually appear rather than being flattened to its endpoints (§17).
 */
function background(style: Bag): string {
  const fill = str(style.fill, "transparent");
  const stops = list(style.gradientStops);
  if (stops.length >= 2) {
    const parts = stops.map((stop) => `${str(stop.color, "#000000")} ${num(stop.offset, 0)}%`).join(", ");
    return str(style.gradientType) === "radial"
      ? `radial-gradient(circle at 50% 50%, ${parts})`
      : `linear-gradient(${num(style.gradientAngle, 135)}deg, ${parts})`;
  }
  if (typeof style.gradientTo === "string") {
    return `linear-gradient(${num(style.gradientAngle, 135)}deg, ${fill}, ${style.gradientTo})`;
  }
  return fill;
}

/** Per-corner radii when the row carries them, one radius when it does not. */
function radius(style: Bag): string | number | undefined {
  const corners = style.borderRadiusCorners;
  if (Array.isArray(corners) && corners.length === 4) {
    return corners.map((corner) => `${num(corner as Json, 0)}px`).join(" ");
  }
  const single = style.borderRadius;
  return typeof single === "number" ? single : undefined;
}

function borderOf(style: Bag): string | undefined {
  const stroke = style.stroke;
  if (typeof stroke !== "string") return undefined;
  return `${num(style.strokeWidth, 1)}px ${str(style.strokeStyle, "solid")} ${stroke}`;
}

/**
 * A box shadow.
 *
 * `shadows` is the JSLAYD list; `shadow: true` is the blueprint flag, and its
 * one plausible reading is the soft card shadow the built-in designs were drawn
 * against — so that is what it keeps meaning.
 */
function boxShadow(style: Bag): string | undefined {
  const shadows = list(style.shadows);
  if (shadows.length) {
    return shadows
      .map((shadow) => {
        const color = withAlpha(str(shadow.color, "#000000"), num(shadow.opacity, 0.2));
        return `${num(shadow.offsetX, 0)}px ${num(shadow.offsetY, 0)}px ${num(shadow.blur, 0)}px ${num(shadow.spread, 0)}px ${color}`;
      })
      .join(", ");
  }
  return style.shadow === true ? "0 10px 22px rgba(26,16,48,.16)" : undefined;
}

function textShadow(style: Bag, color: string): string | undefined {
  const shadows = list(style.shadows);
  if (shadows.length) {
    return shadows
      .map((shadow) => {
        const tint = withAlpha(str(shadow.color, "#000000"), num(shadow.opacity, 0.4));
        return `${num(shadow.offsetX, 0)}px ${num(shadow.offsetY, 0)}px ${num(shadow.blur, 0)}px ${tint}`;
      })
      .join(", ");
  }
  const effect = str(style.textEffect);
  if (effect === "shadow") return "2px 3px 3px rgba(0,0,0,.45)";
  if (effect === "glow") return `0 0 16px ${color}`;
  if (effect === "lift") return "0 7px 12px rgba(0,0,0,.32)";
  return undefined;
}

/** `#RRGGBB` plus an opacity → `rgba(...)`, so shadow colours stay tokenised. */
function withAlpha(hex: string, opacity: number): string {
  const body = hex.replace("#", "");
  const expanded = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
  const channel = (start: number) => Number.parseInt(expanded.slice(start, start + 2), 16) || 0;
  const baseAlpha = expanded.length >= 8 ? channel(6) / 255 : 1;
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${Math.min(1, Math.max(0, opacity * baseAlpha))})`;
}

function decoration(style: Bag): CSSProperties["textDecorationLine"] {
  const saved = str(style.textDecoration);
  const underline = style.underline === true || saved.includes("underline");
  const strike = style.strikethrough === true || saved.includes("line-through");
  if (underline && strike) return "underline line-through";
  if (underline) return "underline";
  if (strike) return "line-through";
  return "none";
}

function vertical(style: Bag): CSSProperties["justifyContent"] {
  const align = str(style.verticalAlign, "center");
  if (align === "top") return "flex-start";
  if (align === "bottom") return "flex-end";
  return "center";
}

/** The font stack: the design's own face first, its declared fallback behind. */
function fontStack(style: Bag): string {
  const family = str(style.fontFamily, str(style.fontWeight) === "700" ? "Manrope_700Bold" : "Manrope_400Regular");
  const fallback = str(style.fontFallback);
  const names = fallback && fallback !== family ? [family, fallback] : [family];
  return [...names.map((name) => `"${name}"`), "Manrope", "sans-serif"].join(", ");
}

/* --------------------------------------------------------------- elements */

function Placeholder({ kind }: { kind: "image" | "video" | "frame" }) {
  const Glyph = kind === "video" ? Video : ImageGlyph;
  return (
    <div className="slide-media-placeholder">
      <Glyph aria-hidden size="28%" strokeWidth={1.6} />
    </div>
  );
}

function MediaElement({ style, content }: { style: Bag; content: Bag }) {
  const uri = str(content.signedUrl) || str(content.url) || str(content.uri);
  const kind = content.kind === "video" ? "video" : content.kind === "frame" ? "frame" : "image";
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  if (!uri || failed || kind === "video") {
    return (
      <>
        <Placeholder kind={kind} />
        {kind === "video" ? <span className="slide-play"><Play aria-hidden fill="currentColor" /></span> : null}
      </>
    );
  }
  return (
    // Signed Storage URLs are ordinary short-lived HTTPS images. They stay as
    // <img>, rather than next/image, so no private URL reaches an optimiser.
    <img
      alt={str(content.alt)}
      draggable={false}
      onError={() => setFailed(true)}
      src={uri}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: str(style.objectFit, "cover") === "contain" ? "contain" : "cover",
        objectPosition: `${num(style.focusX, 0.5) * 100}% ${num(style.focusY, 0.5) * 100}%`,
        borderRadius: radius(style),
      }}
    />
  );
}

function Shape({ style }: { style: Bag }) {
  const shape = str(style.shape);
  const sides = num(style.sides, 0);
  const clip = shape === "triangle"
    ? "polygon(50% 0%, 100% 100%, 0% 100%)"
    : shape === "polygon" && sides >= 3
      ? polygonClip(sides)
      : undefined;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: clip ? undefined : radius(style),
        background: background(style),
        border: clip ? undefined : borderOf(style),
        boxShadow: clip ? undefined : boxShadow(style),
        clipPath: clip,
      }}
    />
  );
}

/** A regular n-gon as a clip path, first vertex at twelve o'clock. */
function polygonClip(sides: number): string {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
    return `${(50 + Math.cos(angle) * 50).toFixed(2)}% ${(50 + Math.sin(angle) * 50).toFixed(2)}%`;
  });
  return `polygon(${points.join(", ")})`;
}

function Icon({ element, style, content }: { element: RenderableSlideElement; style: Bag; content: Bag }) {
  const registry = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const Glyph = registry[str(content.icon, "Sparkles")] ?? Sparkles;
  return (
    <Glyph
      aria-hidden
      color={str(style.color, "#000000")}
      size={Math.min(element.width, element.height)}
      strokeWidth={num(style.strokeWidth, 1.85)}
    />
  );
}

function donutPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const start = ((from - 90) * Math.PI) / 180;
  const end = ((to - 90) * Math.PI) / 180;
  const large = to - from > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)}`;
}

function Chart({ element, style, content }: { element: RenderableSlideElement; style: Bag; content: Bag }) {
  const values = Array.isArray(content.values) ? content.values.filter((value): value is number => typeof value === "number") : [];
  const labels = Array.isArray(content.labels) ? content.labels.map(String) : [];
  if (!values.length) return null;

  const kind = str(content.chartType, "bar");
  const horizontal = str(content.chartKind) === "horizontalBar";
  const series = Array.isArray(style.series) ? style.series.map(String) : [];
  const primary = str(style.color, "#333333");
  const track = str(style.trackColor, "#E5E5E5");
  const labelColor = str(style.labelColor, "#777777");
  const labelSize = num(style.labelSize, 11);
  const showLabels = style.showLabels !== false && labels.length > 0;
  const showValues = style.showValues === true;
  const maximum = Math.max(...values, 1);
  const labelBand = showLabels && !horizontal ? Math.max(16, labelSize * 1.5) : 0;
  const plotHeight = Math.max(4, element.height - labelBand);
  const colorAt = (index: number) => series[index % Math.max(series.length, 1)] ?? primary;

  if (kind === "donut") {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const size = Math.min(element.width, plotHeight);
    const thickness = Math.min(num(style.strokeWidth, size * 0.19), size / 2);
    const r = size / 2 - thickness / 2;
    const cx = element.width / 2;
    const cy = plotHeight / 2;
    // Each arc starts where the ones before it ended. Summing the preceding
    // slices rather than carrying a cursor keeps the map pure — a closure the
    // renderer mutates while it draws is a rerender bug waiting to happen.
    const sweeps = values.map((value) => (value / total) * 359.9);
    const arcs = sweeps.map((sweep, index) => {
      const start = sweeps.slice(0, index).reduce((sum, part) => sum + part, 0);
      return { d: donutPath(cx, cy, r, start, start + sweep), color: colorAt(index) };
    });
    return (
      <svg aria-hidden width={element.width} height={element.height}>
        <circle cx={cx} cy={cy} r={r} stroke={track} strokeWidth={thickness} fill="none" />
        {arcs.map((arc, index) => <path key={index} d={arc.d} stroke={arc.color} strokeWidth={thickness} fill="none" />)}
      </svg>
    );
  }

  if (kind === "line") {
    const step = values.length > 1 ? element.width / (values.length - 1) : element.width;
    const points = values.map((value, index) => `${index * step},${plotHeight - (value / maximum) * plotHeight * 0.92}`).join(" ");
    return (
      <svg aria-hidden width={element.width} height={element.height}>
        <polyline points={`0,${plotHeight} ${points} ${element.width},${plotHeight}`} fill={primary} fillOpacity={0.12} stroke="none" />
        <polyline points={points} fill="none" stroke={primary} strokeWidth={Math.max(2, num(style.strokeWidth, element.height * 0.012))} strokeLinejoin="round" strokeLinecap="round" />
        {values.map((value, index) => <circle key={index} cx={index * step} cy={plotHeight - (value / maximum) * plotHeight * 0.92} r={Math.max(3, element.height * 0.016)} fill={primary} />)}
      </svg>
    );
  }

  const gap = num(style.gap, element.width / (values.length * 4));
  const corner = num(style.cornerRadius, 6);
  if (horizontal) {
    const barHeight = (element.height - gap * (values.length - 1)) / values.length;
    return (
      <svg aria-hidden width={element.width} height={element.height}>
        {values.map((value, index) => (
          <rect
            key={index}
            x={0}
            y={index * (barHeight + gap)}
            width={Math.max(2, (value / maximum) * element.width * 0.94)}
            height={barHeight}
            rx={Math.min(barHeight / 2, corner)}
            fill={colorAt(index)}
          />
        ))}
      </svg>
    );
  }

  const barWidth = (element.width - gap * (values.length - 1)) / values.length;
  return (
    <>
      <svg aria-hidden width={element.width} height={plotHeight}>
        {values.map((value, index) => {
          const height = Math.max(2, (value / maximum) * plotHeight * 0.94);
          return (
            <g key={index}>
              <rect x={index * (barWidth + gap)} y={plotHeight - height} width={barWidth} height={height} rx={Math.min(barWidth / 2, corner)} fill={colorAt(index)} />
              {showValues ? (
                <text
                  x={index * (barWidth + gap) + barWidth / 2}
                  y={plotHeight - height - 4}
                  fill={labelColor}
                  fontSize={labelSize}
                  textAnchor="middle"
                >
                  {value}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {showLabels ? (
        <div className="slide-chart-labels" style={{ height: labelBand }}>
          {values.map((_, index) => (
            <span key={index} style={{ width: barWidth, color: labelColor, fontSize: labelSize }}>{labels[index] ?? ""}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * A table drawn from its own style bag.
 *
 * The built-in blueprints emit `rows` and nothing else, so the defaults have to
 * produce the plain grid those decks have always shown. Everything richer —
 * header colours, zebra rows, per-column widths — arrives only when a JSLAYD
 * design asked for it.
 */
function Table({ element, style, content }: { element: RenderableSlideElement; style: Bag; content: Bag }) {
  const rows = Array.isArray(content.rows) ? content.rows.map((row) => (Array.isArray(row) ? row.map(String) : [])) : [];
  if (!rows.length) return null;
  const columns = Array.isArray(content.columns) ? content.columns.map(String) : [];
  const header = content.header === true && columns.length > 0;
  const count = Math.max(columns.length, ...rows.map((row) => row.length), 1);
  const widths = Array.isArray(style.columnWidths) && style.columnWidths.length === count
    ? style.columnWidths.map((width) => `${num(width as Json, 1 / count) * 100}%`)
    : Array.from({ length: count }, () => `${100 / count}%`);
  const padding = num(style.padding, 6);
  const border = borderOf(style);
  const rowHeight = num(style.rowHeight, element.height / (rows.length + (header ? 1 : 0)));

  const cellBase: CSSProperties = {
    padding,
    textAlign: str(style.align, "left") as CSSProperties["textAlign"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderBottom: border,
  };

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: radius(style), border }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        {header ? (
          <thead>
            <tr style={{ height: rowHeight, background: str(style.headerBackground) || undefined }}>
              {Array.from({ length: count }, (_, index) => (
                <th
                  key={index}
                  style={{
                    ...cellBase,
                    color: str(style.headerColor, "#111111"),
                    fontFamily: fontStack({ fontFamily: style.headerFontFamily, fontFallback: style.headerFontFallback }),
                    fontWeight: str(style.headerFontWeight, "700"),
                    fontSize: num(style.headerSize, 12),
                  }}
                >
                  {columns[index] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              style={{
                height: rowHeight,
                background: (rowIndex % 2 === 1 ? str(style.cellAltBackground) : str(style.cellBackground)) || undefined,
              }}
            >
              {Array.from({ length: count }, (_, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{
                    ...cellBase,
                    color: str(style.cellColor, "#111111"),
                    fontFamily: fontStack({ fontFamily: style.cellFontFamily, fontFallback: style.cellFontFallback }),
                    fontWeight: str(style.cellFontWeight, "400"),
                    fontSize: num(style.cellSize, 12),
                  }}
                >
                  {row[cellIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextElement({ style, content }: { style: Bag; content: Bag }) {
  const color = str(style.color, "#150E24");
  const size = num(style.fontSize, 30);
  const effect = str(style.textEffect);
  const gradient = bag(style.textGradient);
  const painted = effect === "gradientText" && Object.keys(gradient).length > 0;
  const strokeWidth = num(style.textStrokeWidth, 0);

  return (
    <div
      style={{
        width: "100%",
        color: painted ? "transparent" : color,
        ...(painted
          ? { backgroundImage: background(gradient), backgroundClip: "text", WebkitBackgroundClip: "text" }
          : {}),
        fontFamily: fontStack(style),
        fontWeight: str(style.fontWeight, "400"),
        fontSize: size,
        lineHeight: `${num(style.lineHeight, size * 1.2)}px`,
        textAlign: str(style.textAlign, "left") as CSSProperties["textAlign"],
        letterSpacing: num(style.letterSpacing, 0),
        textTransform: str(style.textTransform, "none") as CSSProperties["textTransform"],
        fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
        textDecorationLine: decoration(style),
        textDecorationColor: color,
        textShadow: textShadow(style, color),
        ...(strokeWidth > 0 ? { WebkitTextStrokeWidth: strokeWidth, WebkitTextStrokeColor: str(style.textStroke, color) } : {}),
        ...(effect === "highlight" && typeof style.highlight === "string"
          ? { background: style.highlight, boxDecorationBreak: "clone", padding: "0.08em 0.26em" }
          : {}),
        ...(num(style.blur, 0) > 0 ? { filter: `blur(${num(style.blur, 0)}px)` } : {}),
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}
    >
      {str(content.text, "Matn")}
    </div>
  );
}

function visualOf(element: RenderableSlideElement, style: Bag, content: Bag): ReactNode {
  if (element.type === "text") return <TextElement style={style} content={content} />;
  if (element.type === "image") return <MediaElement style={style} content={content} />;
  if (element.type === "shape") return <Shape style={style} />;
  if (element.type === "icon") return <Icon element={element} style={style} content={content} />;
  if (element.type === "line") {
    return (
      <div style={{
        marginTop: Math.max(1, element.height / 2),
        height: Math.max(1, num(style.strokeWidth, 2)),
        background: str(style.color, "#150E24"),
      }} />
    );
  }
  if (element.type === "chart") return <Chart element={element} style={style} content={content} />;
  if (element.type === "table") return <Table element={element} style={style} content={content} />;
  return <div style={{ width: "100%", height: "100%", borderRadius: 8, background: str(style.fill, "#F6F3FD") }} />;
}

function SlideElement({ element }: { element: RenderableSlideElement }) {
  const style = bag(element.style);
  const content = bag(element.content);
  return (
    <div
      className="slide-element"
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.type === "text" ? undefined : element.height,
        minHeight: element.type === "text" ? element.height : undefined,
        opacity: element.opacity,
        zIndex: element.z_index,
        transform: `rotate(${element.rotation}deg)`,
        overflow: element.type === "image" ? "hidden" : "visible",
        display: element.type === "text" || element.type === "icon" ? "flex" : "block",
        alignItems: element.type === "icon" ? "center" : undefined,
        justifyContent: element.type === "text" ? vertical(style) : element.type === "icon" ? "center" : undefined,
      }}
    >
      {visualOf(element, style, content)}
    </div>
  );
}

/**
 * The slide, at model size. Callers scale it with a transform rather than
 * re-laying it out, so proportions survive every viewport (§86).
 */
export function SlideCanvas({
  slide,
  elements,
  className,
}: {
  slide: Pick<RenderableSlide, "title" | "background">;
  elements: RenderableSlideElement[];
  className?: string;
}) {
  const ground = bag(slide.background);
  const gradient = list(ground.gradientStops).length >= 2 || typeof ground.gradientTo === "string"
    ? background({ ...ground, fill: ground.color })
    : undefined;
  return (
    <div
      aria-label={slide.title ? `Slayd: ${slide.title}` : "Taqdimot slaydi"}
      className={className ?? "web-slide-canvas"}
      style={{
        position: "relative",
        width: SLIDE_MODEL_WIDTH,
        height: SLIDE_MODEL_HEIGHT,
        overflow: "hidden",
        backgroundColor: str(ground.color, "#FFFFFF"),
        ...(gradient ? { backgroundImage: gradient } : {}),
      }}
    >
      {[...elements].sort((first, second) => first.z_index - second.z_index).map((element) => (
        <SlideElement element={element} key={element.id} />
      ))}
    </div>
  );
}

/** Scales a slide to a given pixel width, keeping 16:9. */
export function ScaledSlide({
  slide,
  elements,
  width,
  className,
}: {
  slide: Pick<RenderableSlide, "title" | "background">;
  elements: RenderableSlideElement[];
  width: number;
  className?: string;
}) {
  const scale = width / SLIDE_MODEL_WIDTH;
  return (
    <div style={{ width, height: SLIDE_MODEL_HEIGHT * scale, overflow: "hidden", position: "relative" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute", inset: 0 }}>
        <SlideCanvas slide={slide} elements={elements} className={className} />
      </div>
    </div>
  );
}
