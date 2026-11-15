import * as Haptics from "expo-haptics";
import { GripVertical } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue,
} from "react-native-reanimated";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * "Tartibga soling": the items, put in order with a finger.
 *
 * A row is picked up by holding it for a moment and dragged to its place; the
 * rows it passes slide out of its way as it goes, and it settles where it is
 * let go. The hold is what lets a short swipe still scroll the question — the
 * list sits inside a scroll view, and a drag that started at the first touch
 * fought it for the same finger, which is where the old screen froze.
 *
 * Everything moves on the UI thread: positions are one shared map, each row
 * follows its own entry, and only the finished order crosses back to React —
 * once per drop, not once per frame. The numbers on the left stand still; the
 * items move past them. A screen reader gets "up" and "down" on every row.
 */

const ROW = 58;
const GAP = spacing.sm;
const STEP = ROW + GAP;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

type Item = { id: string; text: string };
type Positions = Record<string, number>;

function orderOf(positions: Positions): string[] {
  "worklet";
  return Object.keys(positions).sort((a, b) => positions[a]! - positions[b]!);
}

/** Moves `id` to `to`, shifting the rows between by one. */
function moved(positions: Positions, id: string, to: number): Positions {
  "worklet";
  const from = positions[id]!;
  const next: Positions = {};
  for (const key of Object.keys(positions)) {
    const at = positions[key]!;
    if (key === id) next[key] = to;
    else if (from < to && at > from && at <= to) next[key] = at - 1;
    else if (from > to && at < from && at >= to) next[key] = at + 1;
    else next[key] = at;
  }
  return next;
}

export function SortableOrder({ items, disabled, onChange }: {
  /** In the order they were dealt; the list keeps its own order from here on. */
  items: readonly Item[];
  disabled?: boolean;
  onChange: (order: string[]) => void;
}) {
  const styles = useStyles();
  const positions = useSharedValue<Positions>(Object.fromEntries(items.map((item, index) => [item.id, index])));

  const pick = useCallback(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, []);
  const pass = useCallback(() => { void Haptics.selectionAsync().catch(() => {}); }, []);

  const step = useCallback((id: string, delta: number) => {
    const current = positions.value;
    const to = Math.max(0, Math.min(items.length - 1, current[id]! + delta));
    if (to === current[id]) return;
    const next = moved(current, id, to);
    positions.value = next;
    pass();
    onChange(orderOf(next));
  }, [items.length, onChange, pass, positions]);

  return (
    <View style={[styles.frame, { height: items.length * STEP - GAP }]}>
      <View style={styles.numbers} pointerEvents="none">
        {items.map((item, index) => (
          <View key={item.id} style={styles.numberCell}>
            <Text style={styles.number}>{index + 1}</Text>
          </View>
        ))}
      </View>
      <View style={styles.track}>
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            count={items.length}
            positions={positions}
            disabled={Boolean(disabled)}
            onPick={pick}
            onPass={pass}
            onDrop={onChange}
            onStep={step}
          />
        ))}
      </View>
    </View>
  );
}

function Row({ item, count, positions, disabled, onPick, onPass, onDrop, onStep }: {
  item: Item;
  count: number;
  positions: SharedValue<Positions>;
  disabled: boolean;
  onPick: () => void;
  onPass: () => void;
  onDrop: (order: string[]) => void;
  onStep: (id: string, delta: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("play");
  const lifted = useSharedValue(false);
  const y = useSharedValue((positions.value[item.id] ?? 0) * STEP);
  const origin = useSharedValue(0);

  // A row that is not in the hand goes wherever the map now says.
  useAnimatedReaction(() => positions.value[item.id] ?? 0, (next, previous) => {
    if (next !== previous && !lifted.value) y.value = withSpring(next * STEP, SPRING);
  });

  const pan = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(160)
    .onStart(() => {
      lifted.value = true;
      origin.value = y.value;
      runOnJS(onPick)();
    })
    .onUpdate((event) => {
      y.value = Math.max(0, Math.min((count - 1) * STEP, origin.value + event.translationY));
      const to = Math.round(y.value / STEP);
      if (to !== positions.value[item.id]) {
        positions.value = moved(positions.value, item.id, to);
        runOnJS(onPass)();
      }
    })
    .onFinalize((_event, success) => {
      if (!lifted.value) return;
      lifted.value = false;
      y.value = withSpring((positions.value[item.id] ?? 0) * STEP, SPRING);
      if (success) runOnJS(onDrop)(orderOf(positions.value));
    }), [count, disabled, item.id, lifted, onDrop, onPass, onPick, origin, positions, y]);

  const look = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { scale: withTiming(lifted.value ? 1.03 : 1, { duration: 140 }) }],
    zIndex: lifted.value ? 10 : 1,
    shadowOpacity: withTiming(lifted.value ? 0.18 : 0, { duration: 140 }),
    elevation: lifted.value ? 8 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.row, disabled && styles.rowLocked, look]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={item.text}
        accessibilityHint={t("answer.dragHint")}
        accessibilityActions={[{ name: "increment", label: t("answer.down") }, { name: "decrement", label: t("answer.up") }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          onStep(item.id, event.nativeEvent.actionName === "increment" ? 1 : -1);
        }}
      >
        <Text style={styles.text} numberOfLines={2}>{item.text}</Text>
        <GripVertical color={disabled ? colors.border : colors.inkSoft} size={20} strokeWidth={2} />
      </Animated.View>
    </GestureDetector>
  );
}

const useStyles = makeStyles((colors) => ({
  frame: { flexDirection: "row", gap: spacing.sm },
  numbers: { width: 30, gap: GAP },
  numberCell: {
    height: ROW, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  number: { ...typography.bodyMedium, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
  track: { flex: 1 },
  row: {
    position: "absolute", left: 0, right: 0, top: 0, height: ROW,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#150E24", shadowOffset: { width: 0, height: 8 }, shadowRadius: 18,
  },
  rowLocked: { opacity: 0.7 },
  text: { ...typography.body, color: colors.ink, flex: 1 },
}));
