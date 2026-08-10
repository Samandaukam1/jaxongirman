import { LinearGradient } from "expo-linear-gradient";
import * as LucideIcons from "lucide-react-native";
import { Image as ImageGlyph, Play, Video as VideoGlyph, type LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";

/**
 * Renderers for the element vocabulary the template engine emits. Kept apart
 * from SlideCanvas so the canvas stays a thin positioning layer.
 */

type Style = Record<string, unknown>;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Angle in degrees → the start/end points expo-linear-gradient expects. */
function gradientPoints(angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return { start: { x: 0.5 - x, y: 0.5 - y }, end: { x: 0.5 + x, y: 0.5 + y } };
}

export function ShapeElement({ style, width, height }: { style: Style; width: number; height: number }) {
  const fill = str(style.fill, "#EEEEEE");
  const gradientTo = typeof style.gradientTo === "string" ? style.gradientTo : null;
  const radius = num(style.borderRadius, 0);
  const stroke = typeof style.stroke === "string" ? style.stroke : null;
  const shadow = style.shadow === true;

  const box = {
    borderRadius: radius,
    ...(stroke ? { borderColor: stroke, borderWidth: num(style.strokeWidth, 1) } : {}),
    // Shadows are drawn by the platform; the colour follows the fill so a card
    // on a dark ground does not get a grey halo.
    ...(shadow ? { shadowColor: "#1A1030", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 5 } : {}),
  };

  if (gradientTo) {
    const { start, end } = gradientPoints(num(style.gradientAngle, 135));
    return <LinearGradient colors={[fill, gradientTo]} start={start} end={end} style={[StyleSheet.absoluteFill, box]} />;
  }
  return <View style={[StyleSheet.absoluteFill, box, { backgroundColor: fill, width, height }]} />;
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
  const series = Array.isArray(style.series) ? style.series.map((color) => String(color)) : [];
  const primary = str(style.color, "#333333");
  const track = str(style.trackColor, "#E5E5E5");
  const labelColor = str(style.labelColor, "#777777");
  if (!values.length || width <= 0 || height <= 0) return null;

  const colorAt = (index: number) => series[index % Math.max(1, series.length)] ?? primary;
  const max = Math.max(...values, 1);
  const labelBand = labels.length ? 20 : 0;
  const plotHeight = Math.max(4, height - labelBand);

  if (type === "donut") {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const size = Math.min(width, plotHeight);
    const radius = size / 2 - size * 0.11;
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
        <Circle cx={cx} cy={cy} r={radius} stroke={track} strokeWidth={size * 0.19} fill="none" />
        {arcs.map((arc, index) => (
          <Path key={index} d={arc.path} stroke={arc.color} strokeWidth={size * 0.19} strokeLinecap="butt" fill="none" />
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
        <Polyline points={points} fill="none" stroke={primary} strokeWidth={Math.max(2, height * 0.012)} strokeLinejoin="round" strokeLinecap="round" />
        {values.map((value, index) => (
          <Circle key={index} cx={index * step} cy={plotHeight - (value / max) * plotHeight * 0.92} r={Math.max(3, height * 0.016)} fill={primary} />
        ))}
      </Svg>
    );
  }

  const gap = width / (values.length * 4);
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
              rx={Math.min(barWidth / 2, 6)}
              fill={colorAt(index)}
            />
          );
        })}
      </Svg>
      {labels.length ? (
        <View style={[styles.labels, { width, height: labelBand }]}>
          {values.map((_, index) => (
            <Text key={index} numberOfLines={1} style={[styles.label, { color: labelColor, width: barWidth }]}>
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
  label: { fontFamily: "Manrope_500Medium", fontSize: 11, textAlign: "center" },
});
