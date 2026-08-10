"use client";

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

type Bag = { [key: string]: Json | undefined };

function bag(value: Json): Bag {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Bag : {};
}

function num(value: Json | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: Json | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function textShadow(style: Bag, color: string): string | undefined {
  if (style.textEffect === "shadow") return "2px 3px 3px rgba(0,0,0,.45)";
  if (style.textEffect === "glow") return `0 0 16px ${color}`;
  if (style.textEffect === "lift") return "0 7px 12px rgba(0,0,0,.32)";
  return undefined;
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
  if (style.verticalAlign === "top") return "flex-start";
  if (style.verticalAlign === "bottom") return "flex-end";
  return "center";
}

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
    // Signed Storage URLs are ordinary short-lived HTTPS images. They are kept
    // as <img>, rather than next/image, so no private URL reaches an optimiser.
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
        borderRadius: num(style.borderRadius, 0),
      }}
    />
  );
}

function Shape({ style }: { style: Bag }) {
  const fill = str(style.fill, "#EEEEEE");
  const gradient = typeof style.gradientTo === "string"
    ? `linear-gradient(${num(style.gradientAngle, 135)}deg, ${fill}, ${style.gradientTo})`
    : fill;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: num(style.borderRadius, 0),
        background: gradient,
        border: typeof style.stroke === "string" ? `${num(style.strokeWidth, 1)}px solid ${style.stroke}` : undefined,
        boxShadow: style.shadow === true ? "0 10px 22px rgba(26,16,48,.16)" : undefined,
      }}
    />
  );
}

function Icon({ element, style, content }: { element: RenderableSlideElement; style: Bag; content: Bag }) {
  const registry = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const Glyph = registry[str(content.icon, "Sparkles")] ?? Sparkles;
  return <Glyph aria-hidden color={str(style.color, "#000000")} size={Math.min(element.width, element.height)} strokeWidth={1.85} />;
}

function donutPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const start = ((from - 90) * Math.PI) / 180;
  const end = ((to - 90) * Math.PI) / 180;
  const large = to - from > 180 ? 1 : 0;
  return `M ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${large} 1 ${cx + radius * Math.cos(end)} ${cy + radius * Math.sin(end)}`;
}

function Chart({ element, style, content }: { element: RenderableSlideElement; style: Bag; content: Bag }) {
  const values = Array.isArray(content.values) ? content.values.filter((value): value is number => typeof value === "number") : [];
  const labels = Array.isArray(content.labels) ? content.labels.map(String) : [];
  if (!values.length) return null;
  const kind = str(content.chartType, "bar");
  const series = Array.isArray(style.series) ? style.series.map(String) : [];
  const primary = str(style.color, "#333333");
  const track = str(style.trackColor, "#E5E5E5");
  const maximum = Math.max(...values, 1);
  const labelBand = labels.length ? 20 : 0;
  const plotHeight = Math.max(4, element.height - labelBand);
  const colorAt = (index: number) => series[index % Math.max(series.length, 1)] ?? primary;

  if (kind === "donut") {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const size = Math.min(element.width, plotHeight);
    const radius = size / 2 - size * 0.11;
    const cx = element.width / 2;
    const cy = plotHeight / 2;
    let cursor = 0;
    const arcs = values.map((value, index) => {
      const sweep = (value / total) * 359.9;
      const arc = { d: donutPath(cx, cy, radius, cursor, cursor + sweep), color: colorAt(index) };
      cursor += sweep;
      return arc;
    });
    return (
      <svg aria-hidden width={element.width} height={element.height}>
        <circle cx={cx} cy={cy} r={radius} stroke={track} strokeWidth={size * 0.19} fill="none" />
        {arcs.map((arc, index) => <path key={index} d={arc.d} stroke={arc.color} strokeWidth={size * 0.19} fill="none" />)}
      </svg>
    );
  }

  if (kind === "line") {
    const step = values.length > 1 ? element.width / (values.length - 1) : element.width;
    const points = values.map((value, index) => `${index * step},${plotHeight - (value / maximum) * plotHeight * 0.92}`).join(" ");
    return (
      <svg aria-hidden width={element.width} height={element.height}>
        <polyline points={`0,${plotHeight} ${points} ${element.width},${plotHeight}`} fill={primary} fillOpacity={0.12} stroke="none" />
        <polyline points={points} fill="none" stroke={primary} strokeWidth={Math.max(2, element.height * 0.012)} strokeLinejoin="round" strokeLinecap="round" />
        {values.map((value, index) => <circle key={index} cx={index * step} cy={plotHeight - (value / maximum) * plotHeight * 0.92} r={Math.max(3, element.height * 0.016)} fill={primary} />)}
      </svg>
    );
  }

  const gap = element.width / (values.length * 4);
  const barWidth = (element.width - gap * (values.length - 1)) / values.length;
  return (
    <>
      <svg aria-hidden width={element.width} height={plotHeight}>
        {values.map((value, index) => {
          const height = Math.max(2, (value / maximum) * plotHeight * 0.94);
          return <rect key={index} x={index * (barWidth + gap)} y={plotHeight - height} width={barWidth} height={height} rx={Math.min(barWidth / 2, 6)} fill={colorAt(index)} />;
        })}
      </svg>
      {labels.length ? (
        <div className="slide-chart-labels" style={{ height: labelBand }}>
          {values.map((_, index) => <span key={index} style={{ width: barWidth, color: str(style.labelColor, "#777777") }}>{labels[index] ?? ""}</span>)}
        </div>
      ) : null}
    </>
  );
}

function Table({ content }: { content: Bag }) {
  const rows = Array.isArray(content.rows) ? content.rows.slice(0, 5) : [];
  return (
    <div className="slide-table">
      {rows.map((row, rowIndex) => (
        <div className="slide-table-row" key={rowIndex}>
          {Array.isArray(row) ? row.slice(0, 4).map((cell, cellIndex) => <span key={cellIndex}>{String(cell ?? "")}</span>) : null}
        </div>
      ))}
    </div>
  );
}

function visualOf(element: RenderableSlideElement, style: Bag, content: Bag): ReactNode {
  if (element.type === "text") {
    const color = str(style.color, "#150E24");
    const size = num(style.fontSize, 30);
    return (
      <div
        style={{
          width: "100%",
          color,
          fontFamily: `"${str(style.fontFamily, style.fontWeight === "700" ? "Manrope_700Bold" : "Manrope_400Regular")}", Manrope, sans-serif`,
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
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        {str(content.text, "Matn")}
      </div>
    );
  }
  if (element.type === "image") return <MediaElement style={style} content={content} />;
  if (element.type === "shape") return <Shape style={style} />;
  if (element.type === "icon") return <Icon element={element} style={style} content={content} />;
  if (element.type === "line") return <div style={{ marginTop: Math.max(1, element.height / 2), height: Math.max(1, num(style.strokeWidth, 2)), background: str(style.color, "#150E24") }} />;
  if (element.type === "chart") return <Chart element={element} style={style} content={content} />;
  if (element.type === "table") return <Table content={content} />;
  return <div style={{ width: "100%", height: "100%", borderRadius: 8, background: str(style.fill, "#F6F3FD") }} />;
}

function SlideElement({ element }: { element: RenderableSlideElement }) {
  const style = bag(element.style);
  const content = bag(element.content);
  return (
    <div
      className="slide-element"
      style={{
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

export function WebSlideCanvas({ slide, elements }: { slide: RenderableSlide; elements: RenderableSlideElement[] }) {
  const background = bag(slide.background);
  return (
    <div
      aria-label={slide.title ? `Slayd: ${slide.title}` : "Taqdimot slaydi"}
      className="web-slide-canvas"
      style={{ backgroundColor: str(background.color, "#FFFFFF") }}
    >
      {[...elements].sort((first, second) => first.z_index - second.z_index).map((element) => <SlideElement element={element} key={element.id} />)}
    </div>
  );
}

export const WEB_SLIDE_SIZE = { width: SLIDE_MODEL_WIDTH, height: SLIDE_MODEL_HEIGHT } as const;
