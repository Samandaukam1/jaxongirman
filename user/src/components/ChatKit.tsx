import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  BookOpen, Camera, Coffee, Gamepad2, GraduationCap, Heart, Lightbulb, MessageCircle, Mic, Music2, PenLine, Presentation, Rocket, Sparkles, Star,
  type LucideIcon,
} from "lucide-react-native";
import { memo, useEffect, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown, ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The small pieces every chat screen shares: the wallpaper behind a
 * conversation, a picture with its "online" dot, the three dots of
 * "typing…", the day between messages, and the sheet of actions a long press
 * or a menu opens. One look for all of them, in both themes.
 */

/* ------------------------------------------------------------- wallpaper */

const DOODLES: LucideIcon[] = [
  MessageCircle, Sparkles, BookOpen, Gamepad2, Music2, Camera, Heart, Star, Lightbulb, GraduationCap, PenLine, Presentation, Rocket, Mic, Coffee,
];

/**
 * Behind a conversation: the brand's lilac wash and, faint over it, a scatter
 * of small drawings — what the app is about: talk, study, play — laid out the
 * same every time so it reads as paper, not noise.
 */
export const ChatWallpaper = memo(function ChatWallpaper() {
  const { scheme, colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const dark = scheme === "dark";
  const step = 74;
  const columns = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const ink = dark ? "rgba(255,255,255,0.055)" : `${colors.primary}17`;
  const cells: ReactNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      const Icon = DOODLES[(at * 7 + row * 3) % DOODLES.length]!;
      const left = column * step + (row % 2 ? step / 2 : 0) - 10;
      const top = row * step + ((column * 13) % 17);
      cells.push(
        <View key={at} style={{ position: "absolute", left, top, transform: [{ rotate: `${((at * 37) % 50) - 25}deg` }] }}>
          <Icon color={ink} size={20 + ((at * 5) % 7)} strokeWidth={1.6} />
        </View>,
      );
    }
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={dark ? ["#1A0E35", "#120A26", "#0D0A1C"] : ["#EEE6FF", "#F6F1FF", "#E8EEFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {cells}
    </View>
  );
});

/* ---------------------------------------------------------------- avatar */

/** A person's picture with the green dot of "online", which pops in and out. */
export function PeerAvatar({ uri, initials, size, online }: { uri: string | null | undefined; initials: string; size: number; online?: boolean }) {
  const styles = useStyles();
  const dot = Math.max(10, Math.round(size * 0.26));
  return (
    <View style={{ width: size, height: size }}>
      <Avatar uri={uri} initials={initials} size={size} />
      {online ? (
        <Animated.View entering={ZoomIn.springify().damping(12)} exiting={ZoomOut.duration(160)}
          style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, borderWidth: Math.max(2, dot / 5) }]} />
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- typing */

function Dot({ delay, color }: { delay: number; color: string }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.set(withDelay(delay, withRepeat(withSequence(
      withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 260 }),
    ), -1)));
  }, [delay, lift]);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 + lift.value * 0.55, transform: [{ translateY: -lift.value * 3 }] }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }, style]} />;
}

/** "typing" with three dots that hop one after another. */
export function TypingDots({ label, color, size = 13 }: { label: string; color: string; size?: number }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 10, paddingBottom: 1 }}>
        <Dot delay={0} color={color} /><Dot delay={140} color={color} /><Dot delay={280} color={color} />
      </View>
      <Text style={{ fontFamily: "JaxongirmanSans_600SemiBold", fontSize: size, color }} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ days */

/** The day between messages: a small frosted pill over the wallpaper. */
export function DayDivider({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.day}>
      <View style={styles.dayPill}><Text style={styles.dayText}>{label}</Text></View>
    </View>
  );
}

/* --------------------------------------------------------- action sheet */

export type SheetAction = { key: string; label: string; icon?: LucideIcon; destructive?: boolean; onPress: () => void };

/**
 * A sheet of actions that slides up from the bottom — the same on a phone and
 * in a browser, where an alert cannot carry buttons. An optional header shows
 * what the actions are about: the message, the person.
 */
export function ActionSheet({ visible, title, message, header, actions, cancelLabel, onClose }: {
  visible: boolean;
  title?: string;
  message?: string;
  header?: ReactNode;
  actions: SheetAction[];
  cancelLabel: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={styles.sheetRoot}>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel={cancelLabel} onPress={onClose} style={styles.scrim} />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(20).stiffness(220)} exiting={SlideOutDown.duration(180)}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
            <View style={styles.grip} />
            {header}
            {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
            {message ? <Text style={styles.sheetMessage}>{message}</Text> : null}
            <View style={styles.sheetGroup}>
              {actions.map(({ key, label, icon: Icon, destructive, onPress }, at) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  onPress={() => { void Haptics.selectionAsync(); onClose(); setTimeout(onPress, 120); }}
                  style={({ pressed }) => [styles.sheetRow, at > 0 && styles.sheetRule, pressed && { backgroundColor: colors.surfaceMuted }]}
                >
                  {Icon ? <Icon color={destructive ? colors.danger : colors.primary} size={20} strokeWidth={2} /> : null}
                  <Text style={[styles.sheetLabel, destructive && { color: colors.danger }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.8 }]}>
              <Text style={styles.sheetCancelText}>{cancelLabel}</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  dot: { position: "absolute", right: -1, bottom: -1, backgroundColor: "#22C55E", borderColor: colors.canvas },
  day: { alignItems: "center", paddingVertical: spacing.sm },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: "rgba(40,22,80,0.32)" },
  dayText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12, color: "#FFFFFF" },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1, backgroundColor: "rgba(12,6,28,0.45)" },
  sheet: {
    marginHorizontal: spacing.sm, gap: spacing.sm, padding: spacing.sm, paddingTop: spacing.xs,
    borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, backgroundColor: colors.canvas,
    maxWidth: 560, alignSelf: "center", width: "100%",
  },
  grip: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginVertical: 6 },
  sheetTitle: { ...typography.bodyMedium, color: colors.ink, textAlign: "center", paddingHorizontal: spacing.md },
  sheetMessage: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  sheetGroup: { borderRadius: 18, overflow: "hidden", backgroundColor: colors.surface },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 54 },
  sheetRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetLabel: { ...typography.body, fontFamily: "JaxongirmanSans_600SemiBold", color: colors.ink },
  sheetCancel: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.surface },
  sheetCancelText: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary },
}));
