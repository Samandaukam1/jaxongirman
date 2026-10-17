import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Clock3, Gift, type LucideIcon } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  Easing, FadeInDown, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withSpring, withTiming, type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { useReduceMotion } from "@/lib/motion";
import { brandInk, gradients } from "@/theme/tokens";

/**
 * The moment something worked — a payment, a transfer, a gift, a listing.
 *
 * One emblem for all of them, in the brand's own material: the deep violet
 * disc of the hero surfaces with a hairline ring. A ring is drawn round it,
 * the tick is drawn inside, a soft halo breathes out once and a short burst of
 * confetti in the brand's violets (gold when money or a gift arrived) falls
 * away. The phone confirms with a success tap as the tick lands. Everything
 * runs on the UI thread, so it stays smooth while the screen behind it loads.
 *
 * Under Reduce Motion the emblem simply appears, finished: no ring sweep, no
 * confetti, no counting — the same information without the movement.
 */

export type SuccessKind = "done" | "coins" | "gift" | "pending";

const EMBLEM = 92;
const BOX = 196;
const RING_R = 60;
const RING_LENGTH = 2 * Math.PI * RING_R;
const TICK = "M31 51 L44 63.5 L69 37";
const TICK_LENGTH = 56;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const VIOLETS = ["#8B54E8", "#6C34C9", "#C7B2F3", "#A47BF0"] as const;
const GOLDS = ["#E2A23B", "#F2C766"] as const;

type Piece = { angle: number; distance: number; size: number; shape: "bar" | "dot" | "chip"; color: string; spin: number; delay: number };

/** Twenty-two pieces, spread evenly round the circle with a fixed jitter — the same burst every time. */
function pieces(kind: SuccessKind): Piece[] {
  const palette = kind === "coins" || kind === "gift" ? [...VIOLETS, ...GOLDS, ...GOLDS] : [...VIOLETS];
  return Array.from({ length: 22 }, (_, index) => {
    const jitter = ((index * 37) % 11) / 11;
    return {
      angle: (index / 22) * Math.PI * 2 + jitter * 0.4,
      distance: 92 + ((index * 53) % 70),
      size: 5 + ((index * 29) % 5),
      shape: (["bar", "dot", "chip"] as const)[index % 3]!,
      color: palette[(index * 7) % palette.length]!,
      spin: (index % 2 ? 1 : -1) * (240 + ((index * 41) % 300)),
      delay: (index % 4) * 18,
    };
  });
}

function Confetti({ piece, progress }: { piece: Piece; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const out = 1 - Math.pow(1 - Math.min(1, t * 1.15), 3);
    const x = Math.cos(piece.angle) * piece.distance * out;
    const y = Math.sin(piece.angle) * piece.distance * out + 70 * t * t;
    return {
      opacity: interpolate(t, [0, 0.06, 0.62, 1], [0, 1, 1, 0]),
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${piece.spin * t}deg` }, { scale: interpolate(t, [0, 0.2, 1], [0.4, 1, 0.75]) }],
    };
  });
  const shape = piece.shape === "dot"
    ? { width: piece.size, height: piece.size, borderRadius: piece.size / 2 }
    : piece.shape === "bar"
      ? { width: piece.size * 2, height: Math.max(2.5, piece.size / 2.2), borderRadius: 2 }
      : { width: piece.size * 1.4, height: piece.size * 1.4, borderRadius: 2.5 };
  return <Animated.View style={[{ position: "absolute", backgroundColor: piece.color }, shape, style]} />;
}

export function SuccessMark({ kind = "done", style }: { kind?: SuccessKind; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion();
  const enter = useSharedValue(reduced ? 1 : 0);
  const ring = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);
  const halo = useSharedValue(reduced ? 1 : 0);
  const burst = useSharedValue(reduced ? 1 : 0);
  const [burstPieces] = useState(() => pieces(kind));
  const celebrates = kind !== "pending";

  useEffect(() => {
    if (reduced) {
      if (celebrates) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    enter.set(withSpring(1, { damping: 13, stiffness: 160, mass: 0.8 }));
    ring.set(withDelay(120, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) })));
    tick.set(withDelay(430, withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) })));
    halo.set(withDelay(620, withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }))));
    if (celebrates) burst.set(withDelay(640, withTiming(1, { duration: 1350, easing: Easing.linear })));
    const tap = setTimeout(() => {
      void Haptics.notificationAsync(celebrates ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    }, 700);
    return () => clearTimeout(tap);
  }, [burst, celebrates, enter, halo, reduced, ring, tick]);

  const emblemStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [0, 0.4, 1], [0, 1, 1]),
    transform: [{ scale: interpolate(enter.value, [0, 1], [0.55, 1]) }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(halo.value, [0, 0.15, 1], [0, 0.35, 0]),
    transform: [{ scale: interpolate(halo.value, [0, 1], [0.9, 1.75]) }],
  }));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - ring.value) }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - tick.value) }));
  const glyphStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: interpolate(tick.value, [0, 1], [0.6, 1]) }],
  }));

  const fill = kind === "coins" || kind === "gift" ? gradients.gold : kind === "pending" ? (["#8C7AAE", "#5B4A7E"] as const) : gradients.hero;
  const ringColor = kind === "coins" || kind === "gift" ? "#E2A23B" : kind === "pending" ? "#B7A9D2" : "#8B54E8";
  const Glyph: LucideIcon | null = kind === "gift" ? Gift : kind === "pending" ? Clock3 : null;

  return (
    <View style={[{ width: BOX, height: BOX, alignItems: "center", justifyContent: "center" }, style]} pointerEvents="none">
      <Animated.View style={[{ position: "absolute", width: EMBLEM, height: EMBLEM, borderRadius: EMBLEM / 2, backgroundColor: ringColor }, haloStyle]} />
      {celebrates && !reduced ? burstPieces.map((piece, index) => <Confetti key={index} piece={piece} progress={burst} />) : null}
      <Svg width={BOX} height={BOX} style={{ position: "absolute" }}>
        <Circle cx={BOX / 2} cy={BOX / 2} r={RING_R} stroke={ringColor} strokeOpacity={0.14} strokeWidth={2} fill="none" />
        <AnimatedCircle
          cx={BOX / 2} cy={BOX / 2} r={RING_R} stroke={ringColor} strokeWidth={2.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`} animatedProps={ringProps}
          transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}
        />
      </Svg>
      <Animated.View style={[{ width: EMBLEM, height: EMBLEM, borderRadius: EMBLEM / 2, overflow: "hidden" }, emblemStyle]}>
        <LinearGradient colors={fill} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={{ position: "absolute", inset: 5, borderRadius: EMBLEM / 2, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }} />
          {Glyph ? (
            <Animated.View style={glyphStyle}><Glyph color={brandInk.strong} size={38} strokeWidth={2.1} /></Animated.View>
          ) : (
            <Svg width={EMBLEM} height={EMBLEM} viewBox="0 0 100 100">
              <AnimatedPath d={TICK} stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none"
                strokeDasharray={`${TICK_LENGTH} ${TICK_LENGTH}`} animatedProps={tickProps} />
            </Svg>
          )}
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

/**
 * The same burst on its own, from the centre of whatever it is laid over — for
 * a success that already has its own mark, such as a deck turning ready while
 * somebody watched it being made. Plays once, with the success tap; under
 * Reduce Motion only the tap.
 */
export function ConfettiBurst({ kind = "done", style }: { kind?: SuccessKind; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion();
  const progress = useSharedValue(0);
  const [burstPieces] = useState(() => pieces(kind));
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (!reduced) progress.set(withTiming(1, { duration: 1350, easing: Easing.linear }));
  }, [progress, reduced]);
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={[{ position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" }, style]}>
      {burstPieces.map((piece, index) => <Confetti key={index} piece={piece} progress={progress} />)}
    </View>
  );
}

/**
 * A figure that counts up to its value as the emblem lands — the amount is the
 * news, so it arrives with it. Shows the exact value at the end, and at once
 * under Reduce Motion.
 */
export function CountUp({ value, format, style, delay = 420, duration = 900 }: {
  value: number;
  format: (value: number) => string;
  style?: StyleProp<TextStyle>;
  delay?: number;
  duration?: number;
}) {
  const reduced = useReduceMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced || value === 0) { setShown(value); return; }
    let frame = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    const wait = setTimeout(() => { frame = requestAnimationFrame(step); }, delay);
    return () => { clearTimeout(wait); cancelAnimationFrame(frame); };
  }, [delay, duration, reduced, value]);
  return <Text style={[{ fontVariant: ["tabular-nums"] }, style]}>{format(shown)}</Text>;
}

/** The lines under the emblem, arriving one after another once it has landed. */
export function Rise({ order = 0, children, style }: { order?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(520 + order * 90).duration(420).springify().damping(18)} style={style}>
      {children}
    </Animated.View>
  );
}
