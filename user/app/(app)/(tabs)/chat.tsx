import { useRouter } from "expo-router";
import { Ban, BellOff, Check, CheckCheck, MessageCircle, Search, SquarePen } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown, LinearTransition, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { useBottomNavSpace } from "@/components/BottomNav";
import { PeerAvatar, TypingDots } from "@/components/ChatKit";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { followInbox, initialsOf, listChats, peerName, type ChatListItem } from "@/lib/chat";
import { chatListTime } from "@/lib/chatTime";
import { useTyping } from "@/lib/chatTyping";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { profileInitials, useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** How many of the newest conversations listen for "typing…". */
const TYPING_ROWS = 15;

/**
 * Chats: one's own round picture at the top (the profile grows out of it),
 * then every conversation, newest first — who is online, who is typing,
 * what was said last (with one tick or two on one's own), and how much is
 * unread. Rows rise in on the first look and slide when a conversation moves
 * to the top.
 */
export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useBottomNavSpace();
  const { user } = useAuth();
  const { profile } = useAccount();
  const [chats, setChats] = useState<ChatListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  // Only the first look rises in; later changes slide.
  const [settled, setSettled] = useState(false);

  const load = useCallback(async () => {
    try {
      setChats(await listChats());
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusRefresh(load, 0);
  useEffect(() => {
    const channel = followInbox(() => { void load(); });
    // Who is online changes without a message: looked at again every 45 seconds.
    const timer = setInterval(() => { void load(); }, 45_000);
    return () => { void supabase.removeChannel(channel); clearInterval(timer); };
  }, [load]);

  const hasChats = chats !== null;
  useEffect(() => {
    if (!hasChats || settled) return;
    const timer = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(timer);
  }, [hasChats, settled]);

  const listening = useMemo(() => (chats ?? []).slice(0, TYPING_ROWS).map((chat) => chat.id), [chats]);
  const typing = useTyping(listening, user?.id ?? null);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/, "");
    if (!term || !chats) return chats ?? [];
    return chats.filter((chat) => `${peerName(chat.peer)} ${chat.peer.username ?? ""}`.toLowerCase().includes(term));
  }, [chats, query]);

  function preview(chat: ChatListItem): string {
    const last = chat.last;
    if (!last) return "";
    const text = last.kind === "text" ? last.body
      : last.kind === "share" ? t("preview.share", { title: last.share_title ?? "" })
      : t(`preview.${last.kind}`);
    return (last.sender_id === user?.id ? t("you") : "") + text.replace(/\s+/g, " ");
  }

  const myName = profile?.full_name?.trim() || (profile?.username ? `@${profile.username}` : "");

  return (
    <View style={[styles.safe, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={myName} onPress={() => router.push("/(app)/chat/profile/me")} hitSlop={6}>
          <Avatar uri={profile?.avatar_url} initials={profileInitials(profile)} size={44} ring />
        </Pressable>
        <Text style={styles.title}>{t("title")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("newChat")} onPress={() => router.push("/(app)/chat/new")} style={styles.newButton}>
          <SquarePen color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <Search color={colors.inkSoft} size={18} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={t("findPlaceholder")} placeholderTextColor={colors.inkSoft} />
      </View>

      {error && !chats ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!chats && !error ? <View style={{ padding: spacing.xl, gap: spacing.md }}><SkeletonCard /><SkeletonCard /></View> : null}
      {chats ? (
        <FlatList
          data={shown}
          keyExtractor={(chat) => chat.id}
          contentContainerStyle={{ paddingBottom: bottom + spacing.xl, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListEmptyComponent={
            <View style={{ padding: spacing.xl }}>
              <EmptyState icon={MessageCircle} title={t("empty")} message={t("emptyBody")} />
            </View>
          }
          renderItem={({ item, index }) => {
            const name = peerName(item.peer);
            const mine = item.last?.sender_id === user?.id;
            const read = Boolean(mine && item.last && item.peer_read_at && item.last.created_at <= item.peer_read_at);
            const isTyping = typing.has(item.id) && !item.peer.blocked;
            return (
              <Animated.View
                entering={settled ? undefined : FadeInDown.delay(Math.min(index, 10) * 45).duration(360)}
                layout={LinearTransition.springify().damping(18)}
              >
                <Pressable
                  onPress={() => router.push({ pathname: "/(app)/chat/[id]", params: { id: item.id, peer: item.peer.id } })}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                >
                  <PeerAvatar uri={item.peer.avatar_url} initials={initialsOf(name)} size={56} online={Boolean(item.peer.online) && !item.peer.blocked} />
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                      {item.peer.blocked ? <Ban color={colors.inkSoft} size={13} /> : null}
                      {item.peer.muted ? <BellOff color={colors.inkSoft} size={13} /> : null}
                      {mine && item.last ? (read
                        ? <CheckCheck color={colors.primary} size={16} strokeWidth={2.4} />
                        : <Check color={colors.inkSoft} size={15} strokeWidth={2.4} />) : null}
                      {item.last ? <Text style={[styles.rowTime, item.unread > 0 && !item.peer.muted && styles.rowTimeUnread]}>{chatListTime(item.last.created_at)}</Text> : null}
                    </View>
                    <View style={styles.rowTop}>
                      <View style={styles.previewSlot}>
                        {isTyping
                          ? <TypingDots label={t("typing")} color={colors.primary} size={14} />
                          : <Text style={styles.rowPreview} numberOfLines={1}>{preview(item)}</Text>}
                      </View>
                      {item.unread > 0 ? (
                        <Animated.View entering={ZoomIn.springify().damping(13)} style={[styles.unread, item.peer.muted && styles.unreadMuted]}>
                          <Text style={styles.unreadText}>{item.unread > 99 ? "99+" : item.unread}</Text>
                        </Animated.View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { ...typography.display, color: colors.ink, flex: 1 },
  newButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, height: 44,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowName: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 16.5, lineHeight: 22, color: colors.ink, flex: 1 },
  rowTime: { ...typography.caption, fontSize: 12.5, color: colors.inkSoft },
  rowTimeUnread: { color: colors.primary, fontFamily: "JaxongirmanSans_600SemiBold" },
  previewSlot: { flex: 1, height: 20, justifyContent: "center" },
  rowPreview: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 14.5, lineHeight: 20, color: colors.inkMuted },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  unreadMuted: { backgroundColor: colors.inkSoft },
  unreadText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 12, color: colors.onPrimary },
  separator: { height: 1, marginLeft: 84, backgroundColor: colors.border },
}));
