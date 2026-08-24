/* eslint-disable react-hooks/refs -- PanResponder handlers only ever run from a
   touch, never during render. The ref is what lets a drag keep measuring from
   the position the finger started at while React re-renders every frame. */
import {
  SLIDE_MODEL_HEIGHT,
  SLIDE_MODEL_WIDTH,
  type Json,
  type RenderableSlide,
  type RenderableSlideElement,
} from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { forwardRef, useMemo, useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from "react-native";

import { ChartElement, IconElement, MediaPlaceholder, PlayBadge, ShapeElement, TableElement } from "@/components/SlideElements";
import { bag, decorationOf, verticalAlignOf } from "@/lib/textStyle";
import { cornersOf, faceOf, gradientOf, textEffectOf } from "@/lib/slideStyle";

/**
 * A slide is paper, not app chrome, so it does not follow the app's theme.
 *
 * The deck carries its own colours and the person who made it chose them; a
 * slide with no stated background is white in both themes, and text with no
 * stated colour is dark on it. Letting the dark palette in here would render
 * near-white body text onto a white slide — invisible on the phone and, worse,
 * invisible on the projector.
 */
const PAPER = "#FFFFFF";
const PAPER_INK = "#150E24";
const PAPER_MUTED = "#F2F0F6";

type Slide = RenderableSlide;
type Element = RenderableSlideElement;
type JsonObject = { [key: string]: Json | undefined };

/** The canvas is authored at this size; the parent scales it to fit. */
export const MODEL_WIDTH = SLIDE_MODEL_WIDTH;
export const MODEL_HEIGHT = SLIDE_MODEL_HEIGHT;

/** How much of an element must stay on the slide when it is dragged off-edge. */
const KEEP_VISIBLE = 24;

function object(value: Json): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function number(value: Json | undefined, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function string(value: Json | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type ElementViewProps = {
  element: Element;
  gestureScale: number;
  interactive: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: () => void;
  onDrag?: (x: number, y: number) => void;
  onDragEnd?: (x: number, y: number) => void;
  onRequestEdit?: (id: string) => void;
  onTextMeasure?: (id: string, height: number) => void;
};

const DOUBLE_TAP_MS = 280;

function ElementView(props: ElementViewProps) {
  const element = props.element;
  // Gesture callbacks read through a ref so a re-render mid-drag never swaps in
  // a stale origin — the drag would otherwise accelerate away from the finger.
  const latest = useRef(props);
  latest.current = props;
  const origin = useRef({ x: element.x, y: element.y });
  const moved = useRef({ x: element.x, y: element.y });
  const lastTap = useRef(0);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.interactive && !latest.current.element.locked,
    onMoveShouldSetPanResponder: (_, gesture) =>
      latest.current.interactive && !latest.current.element.locked && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3,
    onPanResponderGrant: (event) => {
      const current = latest.current;
      origin.current = { x: current.element.x, y: current.element.y };
      moved.current = origin.current;
      current.onSelect?.(current.element.id);
      // The touch carries its own clock, so tap timing stays pure.
      const now = event.nativeEvent.timestamp;
      if (now - lastTap.current < DOUBLE_TAP_MS) current.onRequestEdit?.(current.element.id);
      lastTap.current = now;
      current.onDragStart?.();
    },
    onPanResponderMove: (_, gesture) => {
      const current = latest.current;
      const start = origin.current;
      const x = clamp(start.x + gesture.dx / current.gestureScale, KEEP_VISIBLE - current.element.width, MODEL_WIDTH - KEEP_VISIBLE);
      const y = clamp(start.y + gesture.dy / current.gestureScale, KEEP_VISIBLE - current.element.height, MODEL_HEIGHT - KEEP_VISIBLE);
      moved.current = { x, y };
      current.onDrag?.(x, y);
    },
    onPanResponderRelease: () => latest.current.onDragEnd?.(moved.current.x, moved.current.y),
    onPanResponderTerminate: () => latest.current.onDragEnd?.(moved.current.x, moved.current.y),
  }), []);

  const style = object(element.style);
  const content = object(element.content);
  const frame: ViewStyle = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    opacity: element.opacity,
    transform: [{ rotate: `${element.rotation}deg` }],
    zIndex: element.z_index,
    overflow: element.type === "image" ? "hidden" : "visible",
    // For text the stored height is a floor, not a ceiling: narrowing the box
    // has to be able to add a line instead of clipping one. Type stays centred
    // in it, so the outline the editor draws is also where the words are.
    ...(element.type === "text"
      ? { minHeight: element.height, justifyContent: verticalAlignOf(style) }
      : { height: element.height }),
  };
  const imageUri = element.type === "image"
    ? string(content.signedUrl) || string(content.url) || string(content.uri)
    : "";
  const [failedImage, setFailedImage] = useState<string | null>(null);

  let visual: React.ReactNode;
  if (element.type === "text") {
    const color = string(style.color, PAPER_INK);
    const fontSize = number(style.fontSize, 30);
    const measure = props.onTextMeasure;
    // No line cap: a narrower box has to wrap onto another line rather than
    // swallow the rest of the sentence behind an ellipsis. `content.maxLines`
    // stays as authoring guidance for the generator.
    visual = (
      <Text
        adjustsFontSizeToFit={false}
        onTextLayout={measure ? (event) => measure(element.id, event.nativeEvent.lines.reduce((total, line) => total + line.height, 0)) : undefined}
        style={{
          color,
          // The design's own face once it has loaded, and the fallback it
          // nominated until then — never a face this canvas chose (§78).
          fontFamily: faceOf(style),
          fontSize,
          lineHeight: number(style.lineHeight, fontSize * 1.2),
          textAlign: (string(style.textAlign, "left") as "left" | "center" | "right" | "justify"),
          letterSpacing: number(style.letterSpacing, 0),
          textTransform: (string(style.textTransform, "none") as "none" | "uppercase" | "lowercase" | "capitalize"),
          fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
          textDecorationLine: decorationOf(bag(element.style)),
          textDecorationColor: color,
          includeFontPadding: false,
          ...(string(style.textEffect) === "highlight" && typeof style.highlight === "string"
            ? { backgroundColor: style.highlight }
            : {}),
          ...textEffectOf(style, color),
        }}
      >
        {string(content.text, "Matn")}
      </Text>
    );
  } else if (element.type === "image") {
    // Frames and videos are image elements too — the kind only changes what is
    // drawn while the slot is empty and whether a play badge sits on top.
    const kind = string(content.kind) === "video" ? "video" : string(content.kind) === "frame" ? "frame" : "image";
    const cornerRadius = number(style.borderRadius, 0);
    visual = (
      <>
        {imageUri && failedImage !== imageUri && kind !== "video"
          ? <Image onError={() => setFailedImage(imageUri)} source={{ uri: imageUri }} resizeMode={(string(style.objectFit, "cover") as "cover" | "contain")} style={[StyleSheet.absoluteFill, cornersOf(style)]} />
          : <MediaPlaceholder kind={kind} width={element.width} height={element.height} borderRadius={cornerRadius} />}
        {kind === "video" ? <PlayBadge width={element.width} height={element.height} /> : null}
      </>
    );
  } else if (element.type === "shape") {
    visual = <ShapeElement style={style} width={element.width} height={element.height} />;
  } else if (element.type === "icon") {
    visual = <IconElement style={style} content={content} width={element.width} height={element.height} />;
  } else if (element.type === "line") {
    visual = <View style={{ marginTop: Math.max(1, element.height / 2), height: Math.max(1, number(style.strokeWidth, 2)), backgroundColor: string(style.color, PAPER_INK) }} />;
  } else if (element.type === "chart") {
    visual = <ChartElement style={style} content={content} width={element.width} height={element.height} />;
  } else if (element.type === "table") {
    visual = <TableElement style={style} content={content} width={element.width} height={element.height} />;
  } else {
    visual = <View style={[StyleSheet.absoluteFill, { backgroundColor: string(style.fill, PAPER_MUTED), borderRadius: 8 }]} />;
  }

  // The selection frame lives in SelectionOverlay, above the clipped canvas, so
  // handles stay crisp at any zoom and never land in an exported image.
  return <View {...pan.panHandlers} style={frame}>{visual}</View>;
}

type Props = {
  slide: Slide;
  elements: Element[];
  displayScale?: number;
  interactive?: boolean;
  onSelect?: (id: string | null) => void;
  onDragStart?: () => void;
  onDrag?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onRequestEdit?: (id: string) => void;
  /** Reports how tall a text element's wrapped copy actually is, in model units. */
  onTextMeasure?: (id: string, height: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export const SlideCanvas = forwardRef<View, Props>(function SlideCanvas(
  { slide, elements, displayScale = 1, interactive = false, onSelect, onDragStart, onDrag, onDragEnd, onRequestEdit, onTextMeasure, onLayout },
  ref,
) {
  const background = object(slide.background);
  const groundGradient = gradientOf(background as Record<string, unknown>);

  // Elements claim the responder first, so the canvas only becomes responder for
  // taps that land on bare background — which is the one gesture that clears the
  // selection. Lifting a finger off an element no longer deselects it.
  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={onLayout}
      style={[styles.canvas, { backgroundColor: string(background.color, PAPER) }]}
      onStartShouldSetResponder={interactive ? () => true : undefined}
      onResponderRelease={interactive ? () => onSelect?.(null) : undefined}
    >
      {groundGradient ? (
        <LinearGradient
          colors={groundGradient.colors as [string, string, ...string[]]}
          locations={groundGradient.locations as [number, number, ...number[]]}
          start={groundGradient.start}
          end={groundGradient.end}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {elements.map((element) => (
        <ElementView
          key={element.id}
          element={element}
          gestureScale={displayScale}
          interactive={interactive}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDrag={(x, y) => onDrag?.(element.id, x, y)}
          onDragEnd={(x, y) => onDragEnd?.(element.id, x, y)}
          onRequestEdit={onRequestEdit}
          onTextMeasure={onTextMeasure}
        />
      ))}
    </View>
  );
});

// Canvas model coordinates are 1000 × 562.5. The parent scales this component.
const styles = StyleSheet.create({
  canvas: { width: MODEL_WIDTH, height: MODEL_HEIGHT, overflow: "hidden" },
  table: { flex: 1, borderWidth: 1, borderColor: "rgba(21,26,24,.18)" },
  tableRow: { flex: 1, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(21,26,24,.12)" },
  cell: { flex: 1, padding: 4, color: PAPER_INK, borderRightWidth: 1, borderRightColor: "rgba(21,26,24,.12)" },
});
