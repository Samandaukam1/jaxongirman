import { LinearGradient } from "expo-linear-gradient";
import { Camera, Check, FileText, Gamepad2, Images, Presentation } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MINE } from "@/components/ChatBubbles";
import { SendGlyph } from "@/components/SendGlyph";
import { MAX_PICK, myShareables, type ChatShare, type Shareable } from "@/lib/chat";
import { formatRelativeDate } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const TABS: ChatShare["kind"][] = ["presentation", "game", "academic"];
const ICONS = { presentation: Presentation, game: Gamepad2, academic: FileText } as const;

/**
 * What the paperclip opens: pictures from the gallery (up to ten, as one
 * album) or the camera, and one's own finished decks, games and scientific
 * works — ticked, up to ten at once, sent together.
 */
export function AttachSheet({ visible, me, onClose, onGallery, onCamera, onShares }: {
  visible: boolean;
  me: string;
  onClose: () => void;
  onGallery: () => void;
  onCamera: () => void;
  onShares: (items: Shareable[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<ChatShare["kind"]>("presentation");
  const [items, setItems] = useState<Shareable[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Shareable[]>([]);

  useEffect(() => {
    if (!visible || !me) return;
    let alive = true;
    void myShareables(me).then((rows) => { if (alive) { setItems(rows); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [me, visible]);

  const shown = useMemo(() => (items ?? []).filter((item) => item.kind === tab), [items, tab]);

  function toggle(item: Shareable) {
    const on = picked.some((other) => other.kind === item.kind && other.id === item.id);
    if (!on && picked.length >= MAX_PICK) { haptic.warning(); return; }
    haptic.select();
    setPicked((current) => (on ? current.filter((other) => !(other.kind === item.kind && other.id === item.id)) : [...current, item]));
  }

  function close() {
    setPicked([]);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      {visible ? (
        <View style={styles.root}>
          <Animated.View entering={FadeIn.duration(80)} exiting={FadeOut.duration(70)} style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel={t("cancel")} onPress={close} style={styles.scrim} />
          </Animated.View>
          <Animated.View entering={SlideInDown.duration(120)} exiting={SlideOutDown.duration(90)}
            style={[styles.sheet, { maxHeight: height * 0.82, paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}>
            <View style={styles.grip} />
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t("m.attachTitle")}</Text>
              <Text style={styles.hint}>{t("m.pickLimit")}</Text>
            </View>

            <View style={styles.tiles}>
              <Pressable accessibilityRole="button" onPress={() => { haptic.light(); close(); setTimeout(onGallery, 80); }} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                <LinearGradient colors={["#8E57EC", "#5A2DB4"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tileIcon}>
                  <Images color="#FFFFFF" size={24} strokeWidth={2} />
                </LinearGradient>
                <Text style={styles.tileLabel}>{t("m.gallery")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { haptic.light(); close(); setTimeout(onCamera, 80); }} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                <LinearGradient colors={["#35C6DA", "#1E8FB0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tileIcon}>
                  <Camera color="#FFFFFF" size={24} strokeWidth={2} />
                </LinearGradient>
                <Text style={styles.tileLabel}>{t("m.camera")}</Text>
              </Pressable>
            </View>

            <View style={styles.tabs}>
              {TABS.map((kind) => {
                const Icon = ICONS[kind];
                const on = tab === kind;
                const count = picked.filter((item) => item.kind === kind).length;
                return (
                  <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    onPress={() => { haptic.select(); setTab(kind); }} style={[styles.tab, on && styles.tabOn]}>
                    <Icon color={on ? colors.primary : colors.inkMuted} size={16} strokeWidth={2.2} />
                    <Text style={[styles.tabText, on && { color: colors.primary }]} numberOfLines={1}>{t(`m.tabs.${kind}`)}</Text>
                    {count ? <View style={styles.tabCount}><Text style={styles.tabCountText}>{count}</Text></View> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={{ height: Math.min(330, height * 0.36) }}>
              {!items && !failed ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}
              {failed ? <Text style={styles.empty}>{t("failed")}</Text> : null}
              {items && !shown.length ? <Text style={styles.empty}>{t("m.nothingReady")}</Text> : null}
              <FlatList
                data={shown}
                keyExtractor={(item) => `${item.kind}:${item.id}`}
                contentContainerStyle={{ paddingVertical: 4 }}
                renderItem={({ item }) => {
                  const Icon = ICONS[item.kind];
                  const on = picked.some((other) => other.kind === item.kind && other.id === item.id);
                  return (
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(item)}
                      style={({ pressed }) => [styles.item, on && styles.itemOn, pressed && styles.pressed]}>
                      <View style={[styles.itemIcon, on && { backgroundColor: colors.primary }]}>
                        <Icon color={on ? "#FFFFFF" : colors.primary} size={20} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                        <Text style={styles.itemDate}>{formatRelativeDate(item.created_at)}</Text>
                      </View>
                      <View style={[styles.check, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                        {on ? <Animated.View entering={ZoomIn.duration(70)}><Check color="#FFFFFF" size={14} strokeWidth={3} /></Animated.View> : null}
                      </View>
                    </Pressable>
                  );
                }}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={!picked.length}
              onPress={() => { const chosen = picked; haptic.light(); close(); setTimeout(() => onShares(chosen), 80); }}
              style={({ pressed }) => [styles.send, !picked.length && { opacity: 0.4 }, pressed && styles.pressed]}
            >
              <LinearGradient colors={MINE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendFill}>
                <SendGlyph size={19} color="#FFFFFF" fold={MINE[1]} />
                <Text style={styles.sendText}>{picked.length ? t("m.sendCount", { count: picked.length }) : t("send")}</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1, backgroundColor: "rgba(12,6,28,0.45)" },
  sheet: {
    marginHorizontal: spacing.sm, padding: spacing.md, paddingTop: spacing.xs, gap: spacing.md,
    borderRadius: 28, borderCurve: "continuous", backgroundColor: colors.canvas, maxWidth: 560, alignSelf: "center", width: "100%",
  },
  grip: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginVertical: 6 },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 4 },
  title: { ...typography.title, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: 18, borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  tileIcon: { width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  tileLabel: { ...typography.bodyMedium, color: colors.ink },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 36, borderRadius: radius.pill, paddingHorizontal: 6 },
  tabOn: { backgroundColor: colors.surface, shadowColor: "#2A0F55", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 12.5, color: colors.inkMuted, flexShrink: 1 },
  tabCount: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  tabCountText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 10.5, color: colors.onPrimary },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: 16, borderCurve: "continuous" },
  itemOn: { backgroundColor: `${colors.primary}12` },
  itemIcon: { width: 42, height: 42, borderRadius: 13, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  itemTitle: { ...typography.bodyMedium, color: colors.ink },
  itemDate: { ...typography.caption, color: colors.inkSoft },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  empty: { ...typography.body, color: colors.inkMuted, textAlign: "center", marginTop: spacing.xl },
  send: { borderRadius: 18, overflow: "hidden" },
  sendFill: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  sendText: { ...typography.bodyMedium, fontFamily: "JaxongirmanSans_700Bold", color: "#FFFFFF" },
  pressed: { opacity: 0.85 },
}));
