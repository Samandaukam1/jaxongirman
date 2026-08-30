import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useReduceMotion } from "@/lib/motion";
import { brandInk, gradients, radius, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A choice of three, where the selection is a thing that moves.
 *
 * The old control was three buttons, one of them filled. Pressing another one
 * swapped which was filled — a cut, with nothing in between, so the eye has to
 * find the selection again after every press instead of following it.
 *
 * Here the selection is one pill that travels. It is the same idea as the
 * Dynamic Island's: the shape does not blink out of one place and into
 * another, it goes, and it deforms slightly on the way because a real object
 * that starts moving quickly does. The squash is worth naming — a pill that
 * translates at constant width reads as a sprite being repositioned, and the
 * same pill stretched along its direction of travel and let go reads as
 * something with mass. It is a tenth of the width, for about a fifth of a
 * second, and you would not notice it if it were missing. That is the point.
 *
 * Labels are drawn twice, once in each state, and the selected copy fades in
 * with the pill's own position rather than on a timer. Anything else flips the
 * text colour a frame before the pill arrives under it, which is the exact
 * thing this control exists to stop.
 *
 * Silent under reduce-motion: the pill is placed, not sent.
 */

export type Segment<K extends string> = {
  key: K;
  label: string;
  icon: LucideIcon;
};

type Props<K extends string> = {
  options: readonly Segment<K>[];
  value: K;
  onChange: (next: K) => void;
};

/** Loose enough to glide, tight enough not to wobble at the end. */
const TRAVEL = { damping: 17, stiffness: 190, mass: 0.75 } as const;
/** The give, once the pill is already moving. */
const SETTLE = { damping: 14, stiffness: 200, mass: 0.6 } as const;
const STRETCH = { duration: 130, easing: Easing.out(Easing.quad) } as const;

/** How far the pill deforms at full stretch. */
const STRETCH_X = 0.08;
const STRETCH_Y = 0.06;

/** The rim the pill sits inside. */
const TRACK_PAD = 4;
const ROW_HEIGHT = 46;

export function SegmentedSwitch<K extends string>({ options, value, onChange }: Props<K>) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReduceMotion();
  const [rowWidth, setRowWidth] = useState(0);

  const index = Math.max(options.findIndex((option) => option.key === value), 0);
  const segment = options.length > 0 ? rowWidth / options.length : 0;

  const offset = useSharedValue(0);
  const stretch = useSharedValue(0);
  /**
   * The first placement is not a move.
   *
   * Width arrives one layout after mount, so until it does every segment is
   * zero wide and the pill's target is zero. Springing to the real target when
   * the measurement lands would animate the pill in from the left edge on every
   * visit to the screen — for somebody whose setting is "Qorong‘i", a control
   * that slides itself into position each time they open Profil.
   */
  const placed = useRef(false);

  useEffect(() => {
    if (segment <= 0) return;
    const to = index * segment;
    if (!placed.current || reduced) {
      placed.current = true;
      offset.value = to;
      return;
    }
    if (offset.value === to) return;
    offset.value = withSpring(to, TRAVEL);
    stretch.value = withSequence(withTiming(1, STRETCH), withSpring(0, SETTLE));
  }, [index, offset, reduced, segment, stretch]);

  const pillStyle = useAnimatedStyle(() => ({
    width: segment,
    opacity: segment > 0 ? 1 : 0,
    transform: [
      { translateX: offset.value },
      { scaleX: 1 + stretch.value * STRETCH_X },
      { scaleY: 1 - stretch.value * STRETCH_Y },
    ],
  }));

  return (
    <View style={styles.track}>
      <View style={styles.row} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.pillFill]}
          />
        </Animated.View>

        {options.map((option, at) => (
          <Choice
            key={option.key}
            option={option}
            at={at}
            offset={offset}
            segment={segment}
            selected={option.key === value}
            muted={colors.inkMuted}
            onPress={() => {
              if (option.key === value) return;
              void Haptics.selectionAsync();
              onChange(option.key);
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One choice, drawn twice.
 *
 * The "on" copy sits over the "off" one and takes its opacity from how far the
 * pill is from this segment — 1 when it is here, 0 by the time it has reached
 * either neighbour. So the ink arrives with the shape rather than ahead of it,
 * and the two are the same movement rather than two things kept in step.
 */
function Choice<K extends string>({
  option, at, offset, segment, selected, muted, onPress,
}: {
  option: Segment<K>;
  at: number;
  offset: SharedValue<number>;
  segment: number;
  selected: boolean;
  muted: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const Glyph = option.icon;

  const onStyle = useAnimatedStyle(() => ({
    opacity: segment > 0 ? Math.max(0, 1 - Math.abs(offset.value / segment - at)) : 0,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={option.label}
      onPress={onPress}
      style={styles.segment}
    >
      <View style={styles.segmentInner}>
        <Glyph color={muted} size={16} strokeWidth={2} />
        <Text numberOfLines={1} style={[styles.label, { color: muted }]}>{option.label}</Text>
      </View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.segmentInner, onStyle]}>
        <Glyph color={brandInk.strong} size={16} strokeWidth={2.2} />
        <Text numberOfLines={1} style={[styles.label, styles.labelOn]}>{option.label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  track: {
    padding: TRACK_PAD,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // No padding here: an absolutely placed child is laid against the border box,
  // so a padded row would sit the pill that padding out of true. The rim comes
  // from the track above instead.
  row: { flexDirection: "row", height: ROW_HEIGHT, alignItems: "center" },
  pill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pillFill: { borderRadius: radius.pill },
  segment: { flex: 1, height: ROW_HEIGHT, alignItems: "center", justifyContent: "center" },
  segmentInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  label: { ...typography.caption, fontFamily: "Manrope_600SemiBold", flexShrink: 1 },
  labelOn: { color: brandInk.strong },
}));
