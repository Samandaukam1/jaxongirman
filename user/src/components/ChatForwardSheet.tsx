import { LinearGradient } from "expo-linear-gradient";
import { Check, Forward, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MINE } from "@/components/ChatBubbles";
import { PeerAvatar } from "@/components/ChatKit";
import { initialsOf, listChats, MAX_PICK, peerName, type ChatListItem } from "@/lib/chat";
import { haptic } from "@/lib/haptics";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Where chosen messages go: one's conversations, newest first, with a search;
 * up to ten ticked at once, then sent with one button.
 */
export function ForwardSheet({ visible, count, onClose, onSend }: {
  visible: boolean;
  /** How many messages are going. */
  count: number;
  onClose: () => void;
  onSend: (conversationIds: string[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [chats, setChats] = useState<ChatListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void listChats().then((rows) => { if (alive) setChats(rows.filter((chat) => !chat.peer.blocked)); }).catch(() => { if (alive) setChats([]); });
    return () => { alive = false; };
  }, [visible]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/, "");
    if (!term || !chats) return chats ?? [];
    return chats.filter((chat) => `${peerName(chat.peer)} ${chat.peer.username ?? ""}`.toLowerCase().includes(term));
  }, [chats, query]);

  function toggle(id: string) {
    const on = picked.includes(id);
    if (!on && picked.length >= MAX_PICK) { haptic.warning(); return; }
    haptic.select();
    setPicked((current) => (on ? current.filter((other) => other !== id) : [...current, id]));
  }

  function close() {
    setPicked([]);
    setQuery("");
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
            style={[styles.sheet, { height: height * 0.72, paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}>
            <View style={styles.grip} />
            <Text style={styles.title}>{t("m.forwardTitle")}</Text>
            <View style={styles.search}>
              <Search color={colors.inkSoft} size={18} />
              <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={t("findPlaceholder")} placeholderTextColor={colors.inkSoft} />
            </View>
            {!chats ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}
            <FlatList
              style={{ flex: 1 }}
              data={shown}
              keyExtractor={(chat) => chat.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const name = peerName(item.peer);
                const on = picked.includes(item.id);
                return (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(item.id)}
                    style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.85 }]}>
                    <PeerAvatar uri={item.peer.avatar_url} initials={initialsOf(name)} size={46} online={Boolean(item.peer.online)} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{name}</Text>
                      {item.peer.username ? <Text style={styles.handle} numberOfLines={1}>@{item.peer.username}</Text> : null}
                    </View>
                    <View style={[styles.check, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                      {on ? <Animated.View entering={ZoomIn.duration(70)}><Check color="#FFFFFF" size={14} strokeWidth={3} /></Animated.View> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!picked.length}
              onPress={() => { const chosen = picked; haptic.light(); close(); setTimeout(() => onSend(chosen), 80); }}
              style={({ pressed }) => [styles.send, !picked.length && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
            >
              <LinearGradient colors={MINE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendFill}>
                <Forward color="#FFFFFF" size={18} strokeWidth={2.3} />
                <Text style={styles.sendText}>{t("m.forward")}{count > 1 ? ` · ${count}` : ""}</Text>
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
    marginHorizontal: spacing.sm, padding: spacing.md, paddingTop: spacing.xs, gap: spacing.sm,
    borderRadius: 28, borderCurve: "continuous", backgroundColor: colors.canvas, maxWidth: 560, alignSelf: "center", width: "100%",
  },
  grip: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginVertical: 6 },
  title: { ...typography.title, color: colors.ink, paddingHorizontal: 4 },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, height: 42,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: 16, borderCurve: "continuous" },
  rowOn: { backgroundColor: `${colors.primary}12` },
  name: { ...typography.bodyMedium, color: colors.ink },
  handle: { ...typography.caption, color: colors.inkSoft },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  send: { borderRadius: 18, overflow: "hidden" },
  sendFill: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  sendText: { ...typography.bodyMedium, fontFamily: "JaxongirmanSans_700Bold", color: "#FFFFFF" },
}));
