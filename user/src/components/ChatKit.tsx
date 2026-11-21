import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  BookOpen, Camera, Coffee, Gamepad2, GraduationCap, Heart, Lightbulb, MessageCircle, Mic, Music2, PenLine, Presentation, Rocket, Sparkles, Star,
  type LucideIcon,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing, FadeIn, FadeInUp, FadeOut, SlideInDown, SlideOutDown, ZoomIn, ZoomOut, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withRepeat,
  withSequence, withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { Avatar } from "@/components/Avatar";
import { haptic } from "@/lib/haptics";
import { spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The small pieces every chat screen shares: the wallpaper behind a
 * conversation, frosted glass for what floats over it, a picture in the
 * app's rounded square with its ring and "online" dot, the three dots of
 * "typing…", the day between messages, the sheet of actions that slides up,
 * and the menu that grows out of a corner. One look for all of them, by day
 * and by night.
 */

/** The app's rounded square: corners this share of the side, drawn as one continuous curve. */
export const SQUIRCLE = 0.3;
export const squircle = (size: number) => ({ width: size, height: size, borderRadius: size * SQUIRCLE, borderCurve: "continuous" as const });

/* ------------------------------------------------------------- wallpaper */

const DOODLES: LucideIcon[] = [
  MessageCircle, Sparkles, BookOpen, Gamepad2, Music2, Camera, Heart, Star, Lightbulb, GraduationCap, PenLine, Presentation, Rocket, Mic, Coffee,
];

/**
 * False for the first frame, then true once the JavaScript thread is idle after it — for what can wait until a
 * screen is up. A browser without idle callbacks (Safari) waits for the next turn instead.
 */
function useAfterFirstFrame(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => setReady(true), { timeout: 300 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return ready;
}

/**
 * Behind a conversation: a soft wash with three glows in it — lilac, rose and
 * sky by day; violet, teal and plum by night — and, faint over it, a scatter
 * of small drawings of what the app is about (talk, study, play), laid out the
 * same every time so it reads as paper, not noise.
 */
export const ChatWallpaper = memo(function ChatWallpaper() {
  const { scheme } = useTheme();
  const { width, height } = useWindowDimensions();
  const drawn = useAfterFirstFrame();
  const dark = scheme === "dark";
  const step = 82;
  const columns = Math.ceil(width / step) + 1;
  // The drawings — some seventy small vector pictures, most of what a conversation mounts first — come a frame
  // after the screen itself: paper this faint arriving a moment later is never seen, the screen opening sooner is.
  const rows = drawn ? Math.ceil(height / step) + 1 : 0;
  const ink = dark ? "rgba(255,255,255,0.05)" : "rgba(108,52,201,0.085)";
  const cells: ReactNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      const Icon = DOODLES[(at * 7 + row * 3) % DOODLES.length]!;
      const left = column * step + (row % 2 ? step / 2 : 0) - 12 + ((at * 11) % 9);
      const top = row * step + ((column * 13) % 19);
      cells.push(
        <View key={at} style={{ position: "absolute", left, top, transform: [{ rotate: `${((at * 37) % 56) - 28}deg` }] }}>
          <Icon color={ink} size={18 + ((at * 5) % 9)} strokeWidth={1.5} />
        </View>,
      );
    }
  }
  const glows = dark
    ? [{ id: "a", x: "88%", y: "8%", color: "#7C4DFF", opacity: 0.32 }, { id: "b", x: "8%", y: "78%", color: "#1FB8A8", opacity: 0.14 }, { id: "c", x: "60%", y: "52%", color: "#B0278A", opacity: 0.12 }]
    : [{ id: "a", x: "10%", y: "10%", color: "#B794FF", opacity: 0.42 }, { id: "b", x: "95%", y: "45%", color: "#FF9ED8", opacity: 0.26 }, { id: "c", x: "15%", y: "92%", color: "#8CCBFF", opacity: 0.3 }];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={dark ? ["#170D35", "#100A26", "#0A0718"] : ["#F4EEFF", "#FCF8FF", "#EDF2FF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {glows.map((glow) => (
            <RadialGradient key={glow.id} id={`glow-${glow.id}`} cx={glow.x} cy={glow.y} rx="70%" ry="45%" fx={glow.x} fy={glow.y}>
              <Stop offset="0" stopColor={glow.color} stopOpacity={glow.opacity} />
              <Stop offset="1" stopColor={glow.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {glows.map((glow) => <Rect key={glow.id} x={0} y={0} width={width} height={height} fill={`url(#glow-${glow.id})`} />)}
      </Svg>
      {cells}
    </View>
  );
});

/* ----------------------------------------------------------------- glass */

/**
 * Frosted glass for what floats over the wallpaper: a blur of what is behind,
 * a tint for the theme, a bright hairline edge, and a soft shadow under it.
 */
export function Glass({ children, style, round, intensity = 50 }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The corner radius; a capsule when half the height. */
  round: number;
  intensity?: number;
}) {
  const { scheme } = useTheme();
  const dark = scheme === "dark";
  return (
    <View style={[styles.glassShadow, { borderRadius: round }, style]}>
      <View style={[StyleSheet.absoluteFill, styles.glassClip, { borderRadius: round, borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.85)" }]}>
        <BlurView
          intensity={intensity}
          tint={dark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(34,20,66,0.42)" : "rgba(255,255,255,0.5)" }]} />
      </View>
      {children}
    </View>
  );
}

/* ---------------------------------------------------------------- avatar */

/** A person's round picture with the green dot of "online", which pops in and out (the chat list). */
export function PeerAvatar({ uri, initials, size, online }: { uri: string | null | undefined; initials: string; size: number; online?: boolean }) {
  const { colors } = useTheme();
  const dot = Math.max(10, Math.round(size * 0.26));
  return (
    <View style={{ width: size, height: size }}>
      <Avatar uri={uri} initials={initials} size={size} />
      {online ? (
        <Animated.View entering={ZoomIn.duration(80)} exiting={ZoomOut.duration(80)}
          style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, borderWidth: Math.max(2, dot / 5), borderColor: colors.canvas }]} />
      ) : null}
    </View>
  );
}

/**
 * A person's picture in the app's rounded square, inside a thin ring of the
 * brand's colours with a gap of the background between — the conversation's
 * header. Initials on violet when there is no picture.
 */
export function SquircleAvatar({ uri, initials, size, online }: { uri: string | null | undefined; initials: string; size: number; online?: boolean }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const ring = 2;
  const gap = 2;
  const inner = size - 2 * (ring + gap);
  const dot = Math.max(10, Math.round(size * 0.24));
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient colors={["#B48CFF", "#6A35C8", "#35C6DA"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, squircle(size)]} />
      <View style={[StyleSheet.absoluteFill, { margin: ring, borderRadius: (size - 2 * ring) * SQUIRCLE, borderCurve: "continuous", backgroundColor: colors.canvas }]} />
      <View style={[squircle(inner), { position: "absolute", left: ring + gap, top: ring + gap, overflow: "hidden" }]}>
        {uri && !failed ? (
          <Image source={{ uri }} style={{ width: inner, height: inner }} onError={() => setFailed(true)} />
        ) : (
          <LinearGradient colors={["#8E57EC", "#5A2DB4"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.initialsFill}>
            <Text style={[styles.initials, { fontSize: inner * 0.36 }]}>{initials}</Text>
          </LinearGradient>
        )}
      </View>
      {online ? (
        <Animated.View entering={ZoomIn.duration(80)} exiting={ZoomOut.duration(80)}
          style={[styles.dot, { right: -2, bottom: -2, width: dot, height: dot, borderRadius: dot / 2, borderWidth: Math.max(2, dot / 5), borderColor: colors.canvas }]} />
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
    <Animated.View entering={FadeIn.duration(80)} exiting={FadeOut.duration(60)} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 10, paddingBottom: 1 }}>
        <Dot delay={0} color={color} /><Dot delay={140} color={color} /><Dot delay={280} color={color} />
      </View>
      <Text style={{ fontFamily: "JaxongirmanSans_600SemiBold", fontSize: size, color }} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ days */

/** The day between messages: a small frosted pill over the wallpaper. Drawn again only when its words change, not with every row of the list. */
export const DayDivider = memo(function DayDivider({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.day}>
      <Glass round={12} style={styles.dayPill}>
        <Text style={[styles.dayText, { color: colors.ink }]}>{label}</Text>
      </Glass>
    </View>
  );
});

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
  const local = useLocalStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={local.sheetRoot}>
          <Animated.View entering={FadeIn.duration(90)} exiting={FadeOut.duration(80)} style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel={cancelLabel} onPress={onClose} style={local.scrim} />
          </Animated.View>
          <Animated.View entering={SlideInDown.duration(120)} exiting={SlideOutDown.duration(90)}
            style={[local.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
            <View style={local.grip} />
            {header}
            {title ? <Text style={local.sheetTitle}>{title}</Text> : null}
            {message ? <Text style={local.sheetMessage}>{message}</Text> : null}
            <View style={local.sheetGroup}>
              {actions.map(({ key, label, icon: Icon, destructive, onPress }, at) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  onPress={() => { haptic.light(); onClose(); setTimeout(onPress, 60); }}
                  style={({ pressed }) => [local.sheetRow, at > 0 && local.sheetRule, pressed && { backgroundColor: colors.surfaceMuted }]}
                >
                  {Icon ? <Icon color={destructive ? colors.danger : colors.primary} size={20} strokeWidth={2} /> : null}
                  <Text style={[local.sheetLabel, destructive && { color: colors.danger }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [local.sheetCancel, pressed && { opacity: 0.8 }]}>
              <Text style={local.sheetCancelText}>{cancelLabel}</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

/* ----------------------------------------------------------- corner menu */

export type CornerItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  /** A switch on the right: on or off. */
  toggle?: boolean;
  onPress: () => void;
};

/**
 * The conversation's own menu, growing out of the corner where its button is
 * — scaled up from that corner on a short ease-out, its rows sliding in one after
 * another — over a dimmed, blurred screen. Rows come in groups; a tap closes
 * the menu first, then acts.
 */
export function CornerMenu({ visible, top, right, header, groups, onClose }: {
  visible: boolean;
  /** Where the menu's top right corner sits on the screen. */
  top: number;
  right: number;
  header?: ReactNode;
  groups: CornerItem[][];
  onClose: () => void;
}) {
  const { colors, scheme } = useTheme();
  const local = useLocalStyles();
  const open = useSharedValue(0);
  const [shown, setShown] = useState(visible);
  /** The row chosen: run once the menu's own window is gone, so the sheet it opens has the screen to itself. */
  const pending = useRef<(() => void) | null>(null);

  const afterClose = useCallback(() => {
    setShown(false);
    const run = pending.current;
    pending.current = null;
    if (run) setTimeout(run, 60);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setShown(true);
    haptic.soft();
    // Out of the corner, smoothly: no bounce.
    open.set(withTiming(1, { duration: 115, easing: Easing.out(Easing.cubic) }));
  }, [open, visible]);

  useEffect(() => {
    if (visible || !shown) return;
    open.set(withTiming(0, { duration: 80, easing: Easing.in(Easing.quad) }, (done) => { if (done) runOnJS(afterClose)(); }));
  }, [afterClose, open, shown, visible]);

  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, open.value * 1.6),
    transform: [
      { translateX: (1 - open.value) * 12 },
      { translateY: (1 - open.value) * -12 },
      { scale: 0.55 + 0.45 * open.value },
    ],
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: open.value }));
  const shownGroups = groups.filter((group) => group.length);
  // Each row's place in the whole menu, for the staggered entrance.
  const firstOf = shownGroups.map((_, at) => shownGroups.slice(0, at).reduce((sum, group) => sum + group.length, 0));

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
        <BlurView intensity={18} tint={scheme === "dark" ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: scheme === "dark" ? "rgba(6,3,16,0.38)" : "rgba(30,14,64,0.16)" }]} />
      </Animated.View>
      <Animated.View style={[local.cornerCard, { top, right, transformOrigin: "100% 0%" }, card]}>
        <Glass round={22} intensity={70} style={local.cornerGlass}>
          {header ? <View style={local.cornerHeader}>{header}</View> : null}
          {shownGroups.map((group, at) => (
            <View key={at} style={[local.cornerGroup, at > 0 && local.cornerGroupRule]}>
              {group.map((item, index) => {
                const delay = 10 + ((firstOf[at] ?? 0) + index) * 11;
                const Icon = item.icon;
                return (
                  <Animated.View key={item.key} entering={FadeInUp.delay(delay).duration(90)}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { haptic.light(); pending.current = item.onPress; onClose(); }}
                      style={({ pressed }) => [local.cornerRow, pressed && { backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(108,52,201,0.08)" }]}
                    >
                      <Icon color={item.destructive ? colors.danger : colors.ink} size={20} strokeWidth={2} />
                      <Text style={[local.cornerLabel, item.destructive && { color: colors.danger }]} numberOfLines={1}>{item.label}</Text>
                      {item.toggle !== undefined ? (
                        <View style={[local.switch, item.toggle && { backgroundColor: colors.primary }]}>
                          <View style={[local.knob, item.toggle && { transform: [{ translateX: 14 }] }]} />
                        </View>
                      ) : null}
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          ))}
        </Glass>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  glassShadow: {
    shadowColor: "#2A0F55", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  glassClip: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderCurve: "continuous" },
  dot: { position: "absolute", right: -1, bottom: -1, backgroundColor: "#22C55E" },
  initialsFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: "JaxongirmanSans_800ExtraBold", color: "#FFFFFF" },
  day: { alignItems: "center", paddingVertical: spacing.sm },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4 },
  dayText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12 },
});

const useLocalStyles = makeStyles((colors) => ({
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1, backgroundColor: "rgba(12,6,28,0.45)" },
  sheet: {
    marginHorizontal: spacing.sm, gap: spacing.sm, padding: spacing.sm, paddingTop: spacing.xs,
    borderRadius: 28, borderCurve: "continuous", backgroundColor: colors.canvas,
    maxWidth: 560, alignSelf: "center", width: "100%",
  },
  grip: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginVertical: 6 },
  sheetTitle: { ...typography.bodyMedium, color: colors.ink, textAlign: "center", paddingHorizontal: spacing.md },
  sheetMessage: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  sheetGroup: { borderRadius: 18, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.surface },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 54 },
  sheetRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetLabel: { ...typography.body, fontFamily: "JaxongirmanSans_600SemiBold", color: colors.ink },
  sheetCancel: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surface },
  sheetCancelText: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary },
  cornerCard: { position: "absolute", width: 262 },
  cornerGlass: { paddingVertical: 6 },
  cornerHeader: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cornerGroup: { paddingVertical: 2 },
  cornerGroupRule: { borderTopWidth: 6, borderTopColor: "rgba(120,100,170,0.10)" },
  cornerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 46 },
  cornerLabel: { flex: 1, fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 15.5, color: colors.ink },
  switch: { width: 34, height: 20, borderRadius: 10, padding: 3, backgroundColor: colors.borderStrong },
  knob: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" },
}));
