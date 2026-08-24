/* eslint-disable react-hooks/refs -- PanResponder handlers only ever run from a
   touch, never during render. The ref is what lets a resize keep measuring from
   the snapshot taken at grant while React re-renders every frame. */
import type { Json, Tables } from "@jaxongirman/types";
import { Copy, Move, RotateCw, Trash2 } from "lucide-react-native";
import { useMemo, useRef } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";

import { MODEL_HEIGHT, MODEL_WIDTH } from "@/components/SlideCanvas";
import { bag, scaleTextStyle, type StyleBag } from "@/lib/textStyle";
import { icon, radius, shadowLifted } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Element = Tables<"slide_elements">;

export type TransformPatch = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  style?: Json;
};

const HANDLE = 18;
const BAR_WIDTH = 11;
const BUTTON = 40;
const PILL_WIDTH = 116;
const PILL_HEIGHT = 52;
const MIN_SIZE = 14;
const KEEP_VISIBLE = 24;
/** Rotation lands on a multiple of 15° when the finger gets this close. */
const SNAP_DEGREES = 4;

type Snapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  centerX: number;
  centerY: number;
  style: StyleBag;
};

type Props = {
  element: Element;
  /** Canvas model units → screen points. */
  scale: number;
  stageWidth: number;
  stageHeight: number;
  onTransformStart: () => void;
  onTransform: (patch: TransformPatch) => void;
  onTransformEnd: (patch: TransformPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapshotOf(element: Element): Snapshot {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    centerX: element.x + element.width / 2,
    centerY: element.y + element.height / 2,
    style: bag(element.style),
  };
}

/**
 * Keeps the corner opposite the dragged handle pinned in place while the box
 * grows around it, which is what a resize feels like once the element is rotated.
 */
function recenter(snapshot: Snapshot, width: number, height: number, kx: number, ky: number) {
  const radians = (snapshot.rotation * Math.PI) / 180;
  const ax = (kx * (width - snapshot.width)) / 2;
  const ay = (ky * (height - snapshot.height)) / 2;
  const centerX = snapshot.centerX + (ax * Math.cos(radians) - ay * Math.sin(radians));
  const centerY = snapshot.centerY + (ax * Math.sin(radians) + ay * Math.cos(radians));
  return { x: centerX - width / 2, y: centerY - height / 2 };
}

/**
 * The on-canvas transform frame: corner handles scale, side bars stretch, and
 * the two round buttons rotate and move. It renders above the clipped canvas so
 * handles keep a constant touch size and never get cut off at the slide edge.
 */
export function SelectionOverlay({
  element,
  scale,
  stageWidth,
  stageHeight,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onDuplicate,
  onDelete,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isText = element.type === "text";
  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = element.width * scale;
  const height = element.height * scale;
  const centerX = (element.x + element.width / 2) * scale;
  const centerY = (element.y + element.height / 2) * scale;
  const boxWidth = width * cos + height * sin;
  const boxHeight = width * sin + height * cos;

  const buttonX = clamp(centerX + boxWidth / 2 + 8, 4, stageWidth - BUTTON - 4);
  const rotateY = clamp(centerY - BUTTON - 4, 4, Math.max(4, stageHeight - BUTTON * 2 - 12));
  const moveY = rotateY + BUTTON + 8;

  const pillLeft = clamp(centerX - PILL_WIDTH / 2, 4, Math.max(4, stageWidth - PILL_WIDTH - 4));
  let pillTop = centerY + boxHeight / 2 + 10;
  if (pillTop + PILL_HEIGHT > stageHeight - 4) pillTop = centerY - boxHeight / 2 - PILL_HEIGHT - 10;
  if (pillTop < 4) pillTop = Math.max(4, stageHeight - PILL_HEIGHT - 8);

  // Gesture handlers read live props through a ref, so a re-render mid-drag can
  // never reset the origin the deltas are measured from.
  const latest = useRef({ element, scale, isText, onTransformStart, onTransform, onTransformEnd, rotateVector: { x: 0, y: 0 } });
  latest.current = {
    element,
    scale,
    isText,
    onTransformStart,
    onTransform,
    onTransformEnd,
    rotateVector: { x: buttonX + BUTTON / 2 - centerX, y: rotateY + BUTTON / 2 - centerY },
  };

  const snapshot = useRef<Snapshot | null>(null);
  const patch = useRef<TransformPatch | null>(null);
  const pivot = useRef<{ x: number; y: number; base: number; angle: number } | null>(null);

  const gestures = useMemo(() => {
    function begin() {
      snapshot.current = snapshotOf(latest.current.element);
      patch.current = null;
      latest.current.onTransformStart();
    }

    function finish() {
      const result = patch.current;
      patch.current = null;
      snapshot.current = null;
      pivot.current = null;
      latest.current.onTransformEnd(result ?? {});
    }

    function emit(next: TransformPatch) {
      patch.current = next;
      latest.current.onTransform(next);
    }

    /** Screen delta → the element's own unrotated axes. */
    function toLocal(dx: number, dy: number) {
      const shot = snapshot.current!;
      const angle = (shot.rotation * Math.PI) / 180;
      const mx = dx / latest.current.scale;
      const my = dy / latest.current.scale;
      return { lx: mx * Math.cos(angle) + my * Math.sin(angle), ly: -mx * Math.sin(angle) + my * Math.cos(angle) };
    }

    function drag(apply: (lx: number, ly: number) => TransformPatch) {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: begin,
        onPanResponderMove: (_, gesture) => {
          if (!snapshot.current) return;
          const { lx, ly } = toLocal(gesture.dx, gesture.dy);
          emit(apply(lx, ly));
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      });
    }

    const corner = (kx: number, ky: number) => drag((lx, ly) => {
      const shot = snapshot.current!;
      const denominator = shot.width * shot.width + shot.height * shot.height;
      const raw = 1 + (kx * shot.width * lx + ky * shot.height * ly) / denominator;
      const factor = clamp(raw, Math.max(MIN_SIZE / shot.width, MIN_SIZE / shot.height), 12);
      const nextWidth = shot.width * factor;
      const nextHeight = shot.height * factor;
      const position = recenter(shot, nextWidth, nextHeight, kx, ky);
      const result: TransformPatch = { ...position, width: nextWidth, height: nextHeight };
      // A corner on a text box scales the type with the frame, Canva-style.
      if (latest.current.isText) result.style = scaleTextStyle(shot.style, factor) as Json;
      return result;
    });

    const sideX = (sign: number) => drag((lx) => {
      const shot = snapshot.current!;
      const nextWidth = Math.max(MIN_SIZE, shot.width + sign * lx);
      const position = recenter(shot, nextWidth, shot.height, sign, 0);
      return { ...position, width: nextWidth };
    });

    const sideY = (sign: number) => drag((_, ly) => {
      const shot = snapshot.current!;
      const nextHeight = Math.max(MIN_SIZE, shot.height + sign * ly);
      const position = recenter(shot, shot.width, nextHeight, 0, sign);
      return { ...position, height: nextHeight };
    });

    const move = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: begin,
      onPanResponderMove: (_, gesture) => {
        const shot = snapshot.current;
        if (!shot) return;
        emit({
          x: clamp(shot.x + gesture.dx / latest.current.scale, KEEP_VISIBLE - shot.width, MODEL_WIDTH - KEEP_VISIBLE),
          y: clamp(shot.y + gesture.dy / latest.current.scale, KEEP_VISIBLE - shot.height, MODEL_HEIGHT - KEEP_VISIBLE),
        });
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });

    const rotate = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        begin();
        const shot = snapshot.current!;
        const touch = event.nativeEvent;
        // Where the finger landed inside the button is known, so the element's
        // centre can be located in page space without measuring any layout.
        const buttonCenterX = touch.pageX - (typeof touch.locationX === "number" ? touch.locationX : BUTTON / 2) + BUTTON / 2;
        const buttonCenterY = touch.pageY - (typeof touch.locationY === "number" ? touch.locationY : BUTTON / 2) + BUTTON / 2;
        const vector = latest.current.rotateVector;
        pivot.current = {
          x: buttonCenterX - vector.x,
          y: buttonCenterY - vector.y,
          base: shot.rotation,
          angle: Math.atan2(vector.y, vector.x),
        };
      },
      onPanResponderMove: (_, gesture) => {
        const origin = pivot.current;
        if (!origin) return;
        const angle = Math.atan2(gesture.moveY - origin.y, gesture.moveX - origin.x);
        let degrees = origin.base + ((angle - origin.angle) * 180) / Math.PI;
        const snapped = Math.round(degrees / 15) * 15;
        if (Math.abs(degrees - snapped) < SNAP_DEGREES) degrees = snapped;
        degrees = ((degrees % 360) + 360) % 360;
        emit({ rotation: Math.round(degrees * 10) / 10 });
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });

    return {
      corners: [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1)],
      sides: [sideX(-1), sideX(1), sideY(-1), sideY(1)],
      move,
      rotate,
    };
  }, []);

  const half = HANDLE / 2;
  const cornerOffsets = [
    { left: -half, top: -half },
    { left: width - half, top: -half },
    { left: -half, top: height - half },
    { left: width - half, top: height - half },
  ];
  const barHeight = clamp(height * 0.42, 16, 34);
  const barWidth = clamp(width * 0.42, 16, 34);
  const sideOffsets = [
    { left: -BAR_WIDTH / 2, top: height / 2 - barHeight / 2, width: BAR_WIDTH, height: barHeight },
    { left: width - BAR_WIDTH / 2, top: height / 2 - barHeight / 2, width: BAR_WIDTH, height: barHeight },
    { left: width / 2 - barWidth / 2, top: -BAR_WIDTH / 2, width: barWidth, height: BAR_WIDTH },
    { left: width / 2 - barWidth / 2, top: height - BAR_WIDTH / 2, width: barWidth, height: BAR_WIDTH },
  ];
  // Text reflows, so it only stretches sideways; every other element resizes freely.
  const activeSides = isText ? 2 : 4;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[
          styles.box,
          { left: centerX - width / 2, top: centerY - height / 2, width, height, transform: [{ rotate: `${element.rotation}deg` }] },
        ]}
      >
        <View pointerEvents="none" style={styles.frame} />
        {gestures.sides.slice(0, activeSides).map((responder, index) => (
          <View key={`side-${index}`} {...responder.panHandlers} hitSlop={14} style={[styles.bar, sideOffsets[index]]} />
        ))}
        {gestures.corners.map((responder, index) => (
          <View key={`corner-${index}`} {...responder.panHandlers} hitSlop={14} style={[styles.handle, cornerOffsets[index]]} />
        ))}
      </View>

      <View {...gestures.rotate.panHandlers} style={[styles.round, { left: buttonX, top: rotateY }]}>
        <RotateCw color={colors.ink} size={icon.md} strokeWidth={icon.strokeBold} />
      </View>
      <View {...gestures.move.panHandlers} style={[styles.round, { left: buttonX, top: moveY }]}>
        <Move color={colors.ink} size={icon.md} strokeWidth={icon.strokeBold} />
      </View>

      <View style={[styles.pill, { left: pillLeft, top: pillTop }]}>
        <Pressable accessibilityLabel="Nusxa olish" hitSlop={6} onPress={onDuplicate} style={styles.pillButton}>
          <Copy color={colors.onPrimary} size={icon.md} strokeWidth={icon.stroke} />
        </Pressable>
        <View style={styles.pillDivider} />
        <Pressable accessibilityLabel="O‘chirish" hitSlop={6} onPress={onDelete} style={styles.pillButton}>
          <Trash2 color={colors.onPrimary} size={icon.md} strokeWidth={icon.stroke} />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { position: "absolute" },
  frame: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderWidth: 1.5, borderColor: colors.primaryBright },
  handle: { position: "absolute", width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primaryBright, ...shadowLifted },
  bar: { position: "absolute", borderRadius: BAR_WIDTH / 2, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primaryBright, ...shadowLifted },
  round: { position: "absolute", width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", ...shadowLifted },
  pill: { position: "absolute", width: PILL_WIDTH, height: PILL_HEIGHT, borderRadius: radius.lg, backgroundColor: colors.primaryDeep, flexDirection: "row", alignItems: "center", justifyContent: "center", ...shadowLifted },
  pillButton: { width: 48, height: PILL_HEIGHT, alignItems: "center", justifyContent: "center" },
  pillDivider: { width: 1, height: 22, backgroundColor: "rgba(255,255,255,.22)" },
}));
