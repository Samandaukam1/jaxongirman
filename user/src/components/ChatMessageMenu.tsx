import { BlurView } from "expo-blur";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BubbleBody, MORE_REACTIONS, QUICK_REACTIONS, type BubbleFrame } from "@/components/ChatBubbles";
import { Glass } from "@/components/ChatKit";
import type { ChatMessage } from "@/lib/chat";
import { haptic } from "@/lib/haptics";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export type MenuAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  /** Set apart from the rows above it by a band, as "Select" is. */
  apart?: boolean;
  onPress: () => void;
};

export type MenuTarget = {
  message: ChatMessage;
  /** Where the bubble was on the screen when it was pressed. */
  frame: BubbleFrame;
  mine: boolean;
  read: boolean;
  groupTop: boolean;
  groupEnd: boolean;
};

const BAR_HEIGHT = 52;
const GAP = 8;
const ROW_HEIGHT = 46;
const APART = 8;
const MENU_WIDTH = 238;
const EDGE = 12;

/**
 * A message pressed and held, the way Telegram shows it: the conversation
 * blurs and dims, the bubble lifts out of its place (moving only as far as it
 * must to leave room), the reactions open above it from its side and the
 * actions below it. A message too tall for the screen keeps its width and
 * scrolls inside its own frame, so the menu always fits. Everything closes
 * the way it came, and only then does the chosen action run.
 */
export function MessageMenu({ target, actions, myReaction, onReact, onClose }: {
  target: MenuTarget | null;
  actions: MenuAction[];
  /** The emoji I put on this message, if any: marked in the bar. */
  myReaction: string | null;
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const { scheme } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const open = useSharedValue(0);
  const [expanded, setExpanded] = useState(false);
  const closing = useRef(false);
  const visible = target !== null;

  useEffect(() => {
    if (!visible) return;
    closing.current = false;
    setExpanded(false);
    open.set(0);
    // Calm, not bouncy: a short ease-out, nothing overshoots.
    open.set(withTiming(1, { duration: 105, easing: Easing.out(Easing.cubic) }));
  }, [open, visible]);

  /** Plays the menu out, then closes it, then runs what was chosen. */
  function close(after?: () => void) {
    if (closing.current) return;
    closing.current = true;
    const finish = () => { onClose(); if (after) setTimeout(after, 20); };
    open.set(withTiming(0, { duration: 75, easing: Easing.in(Easing.quad) }, (done) => { if (done) runOnJS(finish)(); }));
  }

  // Where everything goes: the bubble stays where it was when it can; the bar above it, the menu below it, all on screen.
  const frame = target?.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const mine = Boolean(target?.mine);
  const apartCount = actions.filter((action) => action.apart).length;
  const menuHeight = expanded ? Math.min(286, height * 0.36) : actions.length * ROW_HEIGHT + apartCount * APART + 12;
  const top = insets.top + 10;
  const bottom = height - insets.bottom - 10;
  const room = bottom - top - BAR_HEIGHT - GAP * 2 - menuHeight;
  // The bubble keeps its own height; only a message taller than the room left is clipped (to no less than 72).
  const bubbleHeight = Math.min(frame.height, Math.max(72, room));
  const clipped = frame.height > bubbleHeight + 1;
  const stackHeight = BAR_HEIGHT + GAP + bubbleHeight + GAP + menuHeight;
  const stackTop = Math.max(top, Math.min(frame.y - BAR_HEIGHT - GAP, bottom - stackHeight));
  const bubbleY = stackTop + BAR_HEIGHT + GAP;
  const menuY = bubbleY + bubbleHeight + GAP;
  const barWidth = Math.min(width - EDGE * 2, QUICK_REACTIONS.length * 42 + 54);
  const barX = mine
    ? Math.max(EDGE, Math.min(width - EDGE - barWidth, frame.x + frame.width - barWidth))
    : Math.max(EDGE, Math.min(frame.x, width - EDGE - barWidth));
  const menuWidth = expanded ? width - EDGE * 2 : MENU_WIDTH;
  const menuX = expanded ? EDGE : mine
    ? Math.max(EDGE, Math.min(width - EDGE - menuWidth, frame.x + frame.width - menuWidth))
    : Math.max(EDGE, Math.min(frame.x, width - EDGE - menuWidth));
  const lift = frame.y - bubbleY;
  const origin = mine ? "100%" : "0%";

  const backdrop = useAnimatedStyle(() => ({ opacity: open.value }));
  // The bubble only moves (no swelling); the bar and the menu fade in from a little smaller.
  const bubble = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - open.value) * lift }] }));
  const bar = useAnimatedStyle(() => ({ opacity: open.value, transform: [{ scale: 0.88 + 0.12 * open.value }] }));
  const menu = useAnimatedStyle(() => ({ opacity: open.value, transform: [{ scale: 0.9 + 0.1 * open.value }] }));

  function react(emoji: string) {
    haptic.select();
    close(() => onReact(emoji));
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      {target ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
            <BlurView intensity={32} tint={scheme === "dark" ? "dark" : "light"} style={StyleSheet.absoluteFill} />
            <Pressable accessibilityLabel={t("cancel")} onPress={() => close()}
              style={[StyleSheet.absoluteFill, { backgroundColor: scheme === "dark" ? "rgba(4,2,12,0.42)" : "rgba(24,12,52,0.2)" }]} />
          </Animated.View>

          {/* The bubble, lifted: the same drawing, at the same width. */}
          <Animated.View pointerEvents={clipped ? "auto" : "none"}
            style={[styles.bubble, { left: frame.x, top: bubbleY, width: frame.width, height: bubbleHeight }, bubble]}>
            {clipped ? (
              <ScrollView style={styles.scroller} showsVerticalScrollIndicator={false} bounces={false}>
                <BubbleBody message={target.message} mine={target.mine} read={target.read} groupTop={target.groupTop} groupEnd={target.groupEnd} still />
              </ScrollView>
            ) : (
              <BubbleBody message={target.message} mine={target.mine} read={target.read} groupTop={target.groupTop} groupEnd={target.groupEnd} still />
            )}
          </Animated.View>

          {/* Reactions, from the bubble's side. */}
          <Animated.View style={[styles.barWrap, { left: barX, top: stackTop, width: barWidth, transformOrigin: `${origin} 100%` }, bar]}>
            <Glass round={BAR_HEIGHT / 2} intensity={80} style={styles.bar}>
              {QUICK_REACTIONS.map((emoji, at) => (
                <Animated.View key={emoji} entering={FadeIn.delay(15 + at * 9).duration(80)}>
                  <Pressable accessibilityRole="button" onPress={() => react(emoji)} hitSlop={2}
                    style={({ pressed }) => [styles.emojiButton, myReaction === emoji && styles.emojiMine, pressed && { transform: [{ scale: 1.12 }] }]}>
                    <Text style={styles.emoji}>{emoji}</Text>
                  </Pressable>
                </Animated.View>
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel={t("m.moreReactions")}
                onPress={() => { haptic.select(); setExpanded((value) => !value); }} style={styles.more}>
                {expanded ? <ChevronUp color="#FFFFFF" size={18} strokeWidth={2.6} /> : <ChevronDown color="#FFFFFF" size={18} strokeWidth={2.6} />}
              </Pressable>
            </Glass>
          </Animated.View>

          {/* The actions below — or, opened from the arrow, every reaction. */}
          <Animated.View style={[styles.menuWrap, { left: menuX, top: menuY, width: menuWidth, transformOrigin: `${origin} 0%` }, menu]}>
            <Glass round={20} intensity={80} style={{ height: menuHeight, overflow: "hidden" }}>
              {expanded ? (
                <Animated.View entering={FadeIn.duration(80)} style={{ flex: 1 }}>
                  <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
                    {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                      <Pressable key={emoji} accessibilityRole="button" onPress={() => react(emoji)}
                        style={({ pressed }) => [styles.gridCell, myReaction === emoji && styles.emojiMine, pressed && { transform: [{ scale: 1.1 }] }]}>
                        <Text style={styles.gridEmoji}>{emoji}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </Animated.View>
              ) : (
                <View style={styles.rows}>
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <View key={action.key}>
                        {action.apart ? <View style={styles.apart} /> : null}
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => { haptic.light(); close(action.onPress); }}
                          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                        >
                          <Icon color={action.destructive ? styles.danger.color : styles.label.color} size={20} strokeWidth={2} />
                          <Text style={[styles.label, action.destructive && styles.danger]} numberOfLines={1}>{action.label}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </Glass>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: { position: "absolute" },
  scroller: { flexGrow: 0, borderRadius: 18 },
  barWrap: { position: "absolute", height: BAR_HEIGHT },
  bar: { height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 2 },
  emojiButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emojiMine: { backgroundColor: `${colors.primary}33` },
  emoji: { fontSize: 27 },
  more: {
    width: 32, height: 32, borderRadius: 16, marginLeft: 4, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(110,70,190,0.55)",
  },
  menuWrap: { position: "absolute" },
  rows: { paddingVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, height: ROW_HEIGHT },
  rowPressed: { backgroundColor: `${colors.primary}14` },
  apart: { height: APART, backgroundColor: "rgba(120,100,170,0.12)" },
  label: { flex: 1, fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 16, color: colors.ink },
  danger: { color: colors.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, justifyContent: "center" },
  gridCell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", margin: 2 },
  gridEmoji: { fontSize: 28 },
}));
