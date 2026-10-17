import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { useReduceMotion } from "@/lib/motion";
import { gradients, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * A small success, said without stopping anybody.
 *
 * Saving a card, a file or a template used to open the system alert — a modal
 * box with an OK button, the same box that reports failures. A success needs
 * no answer: this card drops in from the top in the brand's material, draws
 * its tick, taps the phone once and leaves on its own. A tap sends it away
 * sooner. Under Reduce Motion it fades in and out instead of moving.
 */

type Toast = { id: number; title: string; body?: string };

const SuccessToastContext = createContext<(title: string, body?: string) => void>(() => {});

/** `notify(title, body?)` from anywhere under the provider. */
export function useSuccessToast() {
  return useContext(SuccessToastContext);
}

export function SuccessToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const next = useRef(0);
  const notify = useCallback((title: string, body?: string) => {
    next.current += 1;
    setToast({ id: next.current, title, body });
  }, []);
  const value = useMemo(() => notify, [notify]);
  return (
    <SuccessToastContext.Provider value={value}>
      {children}
      {toast ? <ToastCard key={toast.id} toast={toast} onGone={() => setToast((current) => (current?.id === toast.id ? null : current))} /> : null}
    </SuccessToastContext.Provider>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const TICK = "M31 51 L44 63.5 L69 37";
const TICK_LENGTH = 56;
const SHOWN_MS = 2600;

function ToastCard({ toast, onGone }: { toast: Toast; onGone: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const enter = useSharedValue(0);
  const tick = useSharedValue(reduced ? 1 : 0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    enter.set(reduced ? withTiming(1, { duration: 180 }) : withSpring(1, { damping: 16, stiffness: 190, mass: 0.7 }));
    if (!reduced) tick.set(withDelay(200, withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) })));
    const timer = setTimeout(() => setLeaving(true), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [enter, reduced, tick]);

  useEffect(() => {
    if (!leaving) return;
    enter.set(withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }));
    const timer = setTimeout(onGone, 240);
    return () => clearTimeout(timer);
  }, [enter, leaving, onGone]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: reduced ? [] : [{ translateY: (1 - enter.value) * -(insets.top + 90) }, { scale: 0.96 + enter.value * 0.04 }],
  }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - tick.value) }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.layer, { top: insets.top + spacing.sm }, cardStyle]}>
      <Pressable accessibilityRole="alert" onPress={() => setLeaving(true)} style={styles.card}>
        <View style={styles.mark}>
          <LinearGradient colors={gradients.hero} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={styles.markFill}>
            <Svg width={36} height={36} viewBox="0 0 100 100">
              <AnimatedPath d={TICK} stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none"
                strokeDasharray={`${TICK_LENGTH} ${TICK_LENGTH}`} animatedProps={tickProps} />
            </Svg>
          </LinearGradient>
        </View>
        <View style={styles.words}>
          <Text style={styles.title} numberOfLines={2}>{toast.title}</Text>
          {toast.body ? <Text style={styles.body} numberOfLines={3}>{toast.body}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  layer: { position: "absolute", left: spacing.lg, right: spacing.lg, zIndex: 100, alignItems: "center" },
  card: {
    width: "100%", maxWidth: 520, flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadowLifted,
  },
  mark: { width: 40, height: 40, borderRadius: 20, overflow: "hidden" },
  markFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  words: { flex: 1, gap: 2 },
  title: { ...typography.bodyMedium, color: colors.ink },
  body: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
}));
