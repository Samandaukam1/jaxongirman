import { LinearGradient } from "expo-linear-gradient";
import * as LucideIcons from "lucide-react-native";
import { Image as ImageGlyph, Play, Video as VideoGlyph, type LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { borderOf, cornersOf, faceOf, gradientOf, num, shadowOf, str } from "@/lib/slideStyle";

/**
 * Renderers for the element vocabulary the template engine emits. Kept apart
 * from SlideCanvas so the canvas stays a thin positioning layer.
 */

type Style = Record<string, unknown>;

/**
 * A filled box.
 *
 * Reads the same style bag the DOM painter does, through the same helpers, so a
 * shape with three gradient stops and a shadow object draws the same on a phone
 * as it does in the admin preview (§77, §85).
 */
export function ShapeElement({ style, width, height }: { style: Style; width: number; height: number }) {
  const box = { ...cornersOf(style), ...borderOf(style), ...shadowOf(style) };
  const gradient = gradientOf(style);

  /**
   * A library element's outline, when it has one.
   *
   * Checked before the gradient and the box because a silhouette is not a
   * rectangle with a corner radius, and drawing it as one is what made every
   * JElement in a deck look like a stack of blocks. Stretched to the row rather
   * than fitted, since the path was authored inside that row's own box.
   */
  const outline = str(style.path);
  if (outline) {
    return (
      <Svg width={width} height={height} viewBox={str(style.viewBox, "0 0 100 100")} preserveAspectRatio="none">
        <Path d={outline} fill={str(style.fill, "#EEEEEE")} />
      </Svg>
    );
  }

  if (gradient) {
    return (
      <LinearGradient
        colors={gradient.colors as [string, string, ...string[]]}
        locations={gradient.locations as [number, number, ...number[]]}
        start={gradient.start}
        end={gradient.end}
        style={[StyleSheet.absoluteFill, box]}
      />
    );
  }
  return <View style={[StyleSheet.absoluteFill, box, { backgroundColor: str(style.fill, "#EEEEEE"), width, height }]} />;
}

/**
 * A table drawn from its own style bag.
 *
 * The old canvas capped every table at five rows and four columns in fixed
 * 12pt grey, which is not a table so much as a hint that one existed. A JSLAYD
 * design specifies its header, its zebra rows, its column widths and its type,
 * and all of it has to arrive here or the phone shows a different slide from
 * everywhere else.
 */
export function TableElement({ style, content, width, height }: { style: Style; content: Style; width: number; height: number }) {
  const rows = Array.isArray(content.rows) ? content.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [])) : [];
  if (rows.length === 0) return null;

  const columns = Array.isArray(content.columns) ? content.columns.map((column) => String(column ?? "")) : [];
  const header = content.header === true && columns.length > 0;
  const count = Math.max(columns.length, ...rows.map((row) => row.length), 1);
  const widths = Array.isArray(style.columnWidths) && style.columnWidths.length === count
    ? style.columnWidths.map((value) => num(value, 1 / count))
    : Array.from({ length: count }, () => 1 / count);
  const padding = num(style.padding, 6);
  const rowHeight = num(style.rowHeight, height / (rows.length + (header ? 1 : 0)));
  const stroke = typeof style.stroke === "string" ? style.stroke : null;
  const divider = stroke ? { borderBottomWidth: num(style.strokeWidth, 1), borderBottomColor: stroke } : {};
  const align = str(style.align, "left") as "left" | "center" | "right";

  const cell = (text: string, index: number, isHeader: boolean) => (
    <Text
      key={index}
      numberOfLines={2}
      style={{
        width: widths[index] !== undefined ? width * widths[index]! : width / count,
        paddingHorizontal: padding,
        paddingVertical: padding / 2,
        textAlign: align,
        color: str(isHeader ? style.headerColor : style.cellColor, "#111111"),
        fontSize: num(isHeader ? style.headerSize : style.cellSize, 12),
        fontFamily: faceOf({
          fontFamily: isHeader ? style.headerFontFamily : style.cellFontFamily,
          fontFallback: isHeader ? style.headerFontFallback : style.cellFontFallback,
          fontWeight: isHeader ? "700" : "400",
        }),
      }}
    >
      {text}
    </Text>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }, cornersOf(style), borderOf(style)]}>
      {header ? (
        <View style={{ flexDirection: "row", height: rowHeight, alignItems: "center", backgroundColor: str(style.headerBackground) || undefined, ...divider }}>
          {Array.from({ length: count }, (_, index) => cell(columns[index] ?? "", index, true))}
        </View>
      ) : null}
      {rows.map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={{
            flexDirection: "row",
            height: rowHeight,
            alignItems: "center",
            backgroundColor: str(rowIndex % 2 === 1 ? style.cellAltBackground : style.cellBackground) || undefined,
            ...divider,
          }}
        >
          {Array.from({ length: count }, (_, index) => cell(row[index] ?? "", index, false))}
        </View>
      ))}
    </View>
  );
}

export function IconElement({ style, content, width, height }: { style: Style; content: Style; width: number; height: number }) {
  const name = str(content.icon, "Sparkles");
  const registry = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const Glyph = registry[name] ?? registry.Sparkles;
  if (!Glyph) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.center]}>
      <Glyph color={str(style.color, "#000000")} size={Math.min(width, height)} strokeWidth={1.85} />
    </View>
  );
}

/**
 * What an image, frame or video element shows before anything is picked. The
 * dashed edge reads as "drop something here" rather than as a solid block.
 */
export function MediaPlaceholder({ kind, width, height, borderRadius }: { kind: "image" | "video" | "frame"; width: number; height: number; borderRadius: number }) {
  const glyph = Math.max(18, Math.min(width, height) * 0.26);
  const Glyph = kind === "video" ? VideoGlyph : ImageGlyph;
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, styles.placeholder, { borderRadius, borderWidth: Math.max(2, glyph * 0.08) }]}>
      <Glyph color="#8C7BB4" size={glyph} strokeWidth={1.6} />
    </View>
  );
}

/** Videos are drawn as a still tile; the badge says it plays in the export. */
export function PlayBadge({ width, height }: { width: number; height: number }) {
  const size = Math.max(24, Math.min(width, height) * 0.24);
  return (
    <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
      <View style={[styles.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: "rgba(21,14,36,.62)" }]}>
        <Play color="#FFFFFF" fill="#FFFFFF" size={size * 0.46} strokeWidth={1.5} />
      </View>
    </View>
  );
}

type ChartProps = { style: Style; content: Style; width: number; height: number };

function donutPath(cx: number, cy: number, radius: number, from: number, to: number) {
  const start = ((from - 90) * Math.PI) / 180;
  const end = ((to - 90) * Math.PI) / 180;
  const large = to - from > 180 ? 1 : 0;
  return `M ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${large} 1 ${cx + radius * Math.cos(end)} ${cy + radius * Math.sin(end)}`;
}

export function ChartElement({ style, content, width, height }: ChartProps) {
  const values = Array.isArray(content.values) ? content.values.filter((value): value is number => typeof value === "number") : [];
  const labels = Array.isArray(content.labels) ? content.labels.map((label) => String(label)) : [];
  const type = str(content.chartType, "bar");
  const horizontal = str(content.chartKind) === "horizontalBar";
  const series = Array.isArray(style.series) ? style.series.map((color) => String(color)) : [];
  const primary = str(style.color, "#333333");
  const track = str(style.trackColor, "#E5E5E5");
  const labelColor = str(style.labelColor, "#777777");
  const labelSize = num(style.labelSize, 11);
  const showLabels = style.showLabels !== false && labels.length > 0;
  const showValues = style.showValues === true;
  if (!values.length || width <= 0 || height <= 0) return null;

  const colorAt = (index: number) => series[index % Math.max(1, series.length)] ?? primary;
  const max = Math.max(...values, 1);
  const labelBand = showLabels && !horizontal ? Math.max(16, labelSize * 1.5) : 0;
  const plotHeight = Math.max(4, height - labelBand);

  if (type === "donut") {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const size = Math.min(width, plotHeight);
    // The design's declared ring thickness, bounded so it cannot swallow the hole.
    const thickness = Math.min(num(style.strokeWidth, size * 0.19), size / 2);
    const radius = size / 2 - thickness / 2;
    const cx = width / 2;
    const cy = plotHeight / 2;
    // Arcs are laid out before render so nothing mutates during the JSX pass.
    const arcs: { path: string; color: string }[] = [];
    let cursor = 0;
    for (const [index, value] of values.entries()) {
      const sweep = (value / total) * 359.9;
      arcs.push({ path: donutPath(cx, cy, radius, cursor, cursor + sweep), color: colorAt(index) });
      cursor += sweep;
    }
    return (
      <Svg width={width} height={height}>
        <Circle cx={cx} cy={cy} r={radius} stroke={track} strokeWidth={thickness} fill="none" />
        {arcs.map((arc, index) => (
          <Path key={index} d={arc.path} stroke={arc.color} strokeWidth={thickness} strokeLinecap="butt" fill="none" />
        ))}
      </Svg>
    );
  }

  if (type === "line") {
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const points = values.map((value, index) => `${index * step},${plotHeight - (value / max) * plotHeight * 0.92}`).join(" ");
    return (
      <Svg width={width} height={height}>
        <Polyline points={`0,${plotHeight} ${points} ${width},${plotHeight}`} fill={primary} fillOpacity={0.12} stroke="none" />
        <Polyline points={points} fill="none" stroke={primary} strokeWidth={Math.max(2, num(style.strokeWidth, height * 0.012))} strokeLinejoin="round" strokeLinecap="round" />
        {values.map((value, index) => (
          <Circle key={index} cx={index * step} cy={plotHeight - (value / max) * plotHeight * 0.92} r={Math.max(3, height * 0.016)} fill={primary} />
        ))}
      </Svg>
    );
  }

  const gap = num(style.gap, width / (values.length * 4));
  const corner = num(style.cornerRadius, 6);

  if (horizontal) {
    const barHeight = (height - gap * (values.length - 1)) / values.length;
    return (
      <Svg width={width} height={height}>
        {values.map((value, index) => (
          <Rect
            key={index}
            x={0}
            y={index * (barHeight + gap)}
            width={Math.max(2, (value / max) * width * 0.94)}
            height={barHeight}
            rx={Math.min(barHeight / 2, corner)}
            fill={colorAt(index)}
          />
        ))}
      </Svg>
    );
  }

  const barWidth = (width - gap * (values.length - 1)) / values.length;
  return (
    <>
      <Svg width={width} height={plotHeight}>
        {values.map((value, index) => {
          const barHeight = Math.max(2, (value / max) * plotHeight * 0.94);
          return (
            <Rect
              key={index}
              x={index * (barWidth + gap)}
              y={plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx={Math.min(barWidth / 2, corner)}
              fill={colorAt(index)}
            />
          );
        })}
        {showValues ? values.map((value, index) => {
          const barHeight = Math.max(2, (value / max) * plotHeight * 0.94);
          return (
            <SvgText
              key={`v${index}`}
              x={index * (barWidth + gap) + barWidth / 2}
              y={plotHeight - barHeight - 4}
              fill={labelColor}
              fontSize={labelSize}
              textAnchor="middle"
            >
              {String(value)}
            </SvgText>
          );
        }) : null}
      </Svg>
      {showLabels ? (
        <View style={[styles.labels, { width, height: labelBand }]}>
          {values.map((_, index) => (
            <Text key={index} numberOfLines={1} style={[styles.label, { color: labelColor, width: barWidth, fontSize: labelSize }]}>
              {labels[index] ?? ""}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  placeholder: { backgroundColor: "#EFE9F9", borderColor: "#C9BAE6", borderStyle: "dashed" },
  labels: { flexDirection: "row", justifyContent: "space-between", position: "absolute", bottom: 0, left: 0 },
  label: { fontFamily: "Manrope_500Medium", textAlign: "center" },
});
