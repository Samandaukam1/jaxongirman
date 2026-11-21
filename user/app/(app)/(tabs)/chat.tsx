import { useRouter } from "expo-router";
import { Ban, BellOff, Check, CheckCheck, MessageCircle, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, RefreshControl, Text, TextInput, View, type TextStyle } from "react-native";
import Animated, { Easing, FadeInDown, LinearTransition, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { useBottomNavSpace } from "@/components/BottomNav";
import { PeerAvatar, TypingDots } from "@/components/ChatKit";
import { ChatSearchResults } from "@/components/ChatSearchResults";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { followInbox, initialsOf, listChats, peerName, type ChatListItem } from "@/lib/chat";
import { useChatSearch } from "@/lib/chatSearch";
import { chatListTime } from "@/lib/chatTime";
import { useTyping } from "@/lib/chatTyping";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { profileInitials, useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** How many of the newest conversations listen for "typing…". */
const TYPING_ROWS = 15;

/*
 * Motion. Every chat animation runs in half the time it used to (asked for
 * by the person), and calmly: timings that ease out, no springs.
 */
const EASE_OUT = Easing.out(Easing.cubic);
/** The first look: each row rises in this long (was 360 ms)… */
const RISE_MS = 180;
/** …this long after the row above it (was 45 ms)… */
const RISE_STAGGER_MS = 22.5;
/** …and once this has passed, rows no longer rise, they only slide (was 900 ms). */
const SETTLE_MS = 450;
/** A conversation moving to the top slides there; it was a spring that overshot and wobbled before it came to rest. */
const SLIDE_MS = 200;
/** An unread count appears; it was a spring that bounced past its size. */
const BADGE_MS = 150;

const riseIn = (index: number) => FadeInDown.delay(Math.min(index, 10) * RISE_STAGGER_MS).duration(RISE_MS).easing(EASE_OUT);
const slide = LinearTransition.duration(SLIDE_MS).easing(EASE_OUT);
const badgeIn = ZoomIn.duration(BADGE_MS).easing(EASE_OUT);

/** One empty list while the conversations load, so the search has something steady to look through. */
const NO_CHATS: ChatListItem[] = [];

/**
 * Chats: one's own round picture at the top (the profile grows out of it),
 * one search box, then every conversation, newest first — who is online, who
 * is typing, what was said last (with one tick or two on one's own), and how
 * much is unread. Rows rise in on the first look and slide when a
 * conversation moves to the top.
 *
 * The search box is the way to anyone: as soon as something is typed, the
 * list gives way to what was found — one's own chats, people across the app,
 * then messages (see `useChatSearch`). There is no separate new-chat button:
 * a person found here opens their chat.
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
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [hasChats, settled]);

  const listening = useMemo(() => (chats ?? []).slice(0, TYPING_ROWS).map((chat) => chat.id), [chats]);
  const typing = useTyping(listening, user?.id ?? null);

  const search = useChatSearch(query, chats);

  function preview(chat: ChatListItem): string {
    const last = chat.last;
    if (!last) return "";
    const text = last.kind === "text" ? last.body
      : last.kind === "share" ? t("preview.share", { title: last.share_title ?? "" })
      : last.kind === "album" ? t("m.album", { count: last.count ?? 0 })
      : t(`preview.${last.kind}`);
    return (last.sender_id === user?.id ? t("you") : "") + text.replace(/\s+/g, " ");
  }

  /** One conversation's row: in the list (`listed`: it rises in and slides), or among search results (it holds still). */
  function renderChat(item: ChatListItem, index: number, listed: boolean) {
    const name = peerName(item.peer);
    const mine = item.last?.sender_id === user?.id;
    const read = Boolean(mine && item.last && item.peer_read_at && item.last.created_at <= item.peer_read_at);
    const isTyping = typing.has(item.id) && !item.peer.blocked;
    return (
      <Animated.View entering={listed && !settled ? riseIn(index) : undefined} layout={listed ? slide : undefined}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            router.push({ pathname: "/(app)/chat/[id]", params: { id: item.id, peer: item.peer.id } });
          }}
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
                <Animated.View entering={listed ? badgeIn : undefined} style={[styles.unread, item.peer.muted && styles.unreadMuted]}>
                  <Text style={styles.unreadText}>{item.unread > 99 ? "99+" : item.unread}</Text>
                </Animated.View>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  const myName = profile?.full_name?.trim() || (profile?.username ? `@${profile.username}` : "");

  return (
    <View style={[styles.safe, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={myName} onPress={() => router.push("/(app)/chat/profile/me")} hitSlop={6}>
          <Avatar uri={profile?.avatar_url} initials={profileInitials(profile)} size={44} ring />
        </Pressable>
        <Text style={styles.title}>{t("title")}</Text>
      </View>
      <View style={styles.search}>
        <Search color={colors.inkSoft} size={18} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t("search.placeholder")}
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel={t("search.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          // In a browser, Escape empties the box, as it does in any search field there.
          onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === "Escape") setQuery(""); }}
        />
        {search.searching ? <ActivityIndicator color={colors.inkSoft} size="small" /> : null}
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("search.clear")} onPress={() => setQuery("")} hitSlop={8} style={styles.clear}>
            <X color={colors.inkSoft} size={16} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

      {search.active ? (
        <ChatSearchResults
          query={query}
          search={search}
          chats={chats ?? NO_CHATS}
          me={user?.id ?? null}
          bottom={bottom}
          renderChat={(chat) => renderChat(chat, 0, false)}
        />
      ) : (
        <>
          {error && !chats ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {!chats && !error ? <View style={{ padding: spacing.xl, gap: spacing.md }}><SkeletonCard /><SkeletonCard /></View> : null}
          {chats ? (
            <FlatList
              data={chats}
              keyExtractor={(chat) => chat.id}
              contentContainerStyle={{ paddingBottom: bottom + spacing.xl, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
              ListEmptyComponent={
                <View style={{ padding: spacing.xl }}>
                  <EmptyState icon={MessageCircle} title={t("empty")} message={t("emptyBody")} />
                </View>
              }
              renderItem={({ item, index }) => renderChat(item, index, true)}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { ...typography.display, color: colors.ink, flex: 1 },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, height: 44,
  },
  searchInput: {
    flex: 1, ...typography.body, color: colors.ink, paddingVertical: 0,
    // The pill is the field's outline; a browser's focus ring would draw a second one around the text alone.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null),
  },
  clear: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
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
